import { createHash, randomUUID } from "node:crypto"

import { LocalAudioStore } from "@news-podcast/adapters/audio/local"
import { ObjectAudioStore } from "@news-podcast/adapters/audio/object"
import { LeaseLostError } from "@news-podcast/adapters/db/local"
import type {
  JobStage,
  LocalStore,
  WorkerJob,
} from "@news-podcast/adapters/db/local"
import {
  OpenAiPodcastAgent,
  PodcastAgentError,
} from "@news-podcast/adapters/openai-agent"
import {
  VoicevoxProviderError,
  VoicevoxSpeechSynthesizer,
} from "@news-podcast/adapters/voicevox"
import type {
  AudioStore,
  ObjectStore,
  PodcastAgentRunner,
  RssSourceItem,
  SpeechSynthesizer,
} from "@news-podcast/application"
import {
  noopObservability,
  type Observability,
} from "@news-podcast/observability"

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const
export const EPISODE_EXECUTION_POLICY = {
  leaseMs: 60_000,
  leaseCheckMs: 1_000,
  heartbeatMs: 15_000,
  agentDeadlineMs: 10 * 60_000,
  ttsDeadlineMs: 20 * 60_000,
  storeDeadlineMs: 2 * 60_000,
  jobDeadlineMs: 30 * 60_000,
  maximumScriptCharacters: 6_000,
  maximumChunkBytes: 16 * 1024 * 1024,
  maximumAudioBytes: 128 * 1024 * 1024,
} as const

export function validateExecutionPolicy(
  policy: Readonly<Record<keyof typeof EPISODE_EXECUTION_POLICY, number>>
): void {
  if (policy.heartbeatMs * 3 > policy.leaseMs) {
    throw new Error("Heartbeat must run at least three times per lease")
  }
  if (policy.leaseCheckMs > policy.heartbeatMs) {
    throw new Error("Lease checks cannot be slower than heartbeat")
  }
  if (
    policy.agentDeadlineMs >= policy.jobDeadlineMs ||
    policy.ttsDeadlineMs >= policy.jobDeadlineMs ||
    policy.storeDeadlineMs >= policy.jobDeadlineMs
  ) {
    throw new Error("Stage deadlines must be shorter than the job deadline")
  }
  if (
    policy.maximumScriptCharacters > 6_000 ||
    policy.maximumChunkBytes > 16 * 1024 * 1024 ||
    policy.maximumAudioBytes > 128 * 1024 * 1024
  ) {
    throw new Error("Execution limits exceed durable storage constraints")
  }
}

validateExecutionPolicy(EPISODE_EXECUTION_POLICY)

export interface EpisodeProcessorDependencies {
  readonly store: LocalStore
  readonly audio: AudioStore
  readonly agent: PodcastAgentRunner
  readonly speech: SpeechSynthesizer
  readonly objects?: ObjectStore
  readonly voice: { characterName: string; styleName?: string }
  readonly observability?: Observability
}

export class EpisodeProcessor {
  constructor(private readonly dependencies: EpisodeProcessorDependencies) {}

  async process(job: WorkerJob, now = new Date()): Promise<void> {
    const { store } = this.dependencies
    const observability = this.dependencies.observability ?? noopObservability
    const startedAt = performance.now()
    const controller = new AbortController()
    let lastHeartbeatAt = now.getTime()
    const leaseMonitor = setInterval(() => {
      const current = new Date()
      try {
        if (!store.hasActiveLease(job.id, job.leaseToken, current)) {
          controller.abort(new LeaseLostError(job.id))
          return
        }
        if (
          current.getTime() - lastHeartbeatAt >=
          EPISODE_EXECUTION_POLICY.heartbeatMs
        ) {
          store.renewLease(job.id, job.leaseToken, current)
          lastHeartbeatAt = current.getTime()
        }
      } catch (error) {
        controller.abort(
          error instanceof Error ? error : new LeaseLostError(job.id)
        )
      }
    }, EPISODE_EXECUTION_POLICY.leaseCheckMs)
    leaseMonitor.unref()
    const deadlineTimer = setTimeout(
      () => controller.abort(new JobDeadlineExceededError()),
      Math.max(0, job.deadlineAt.getTime() - now.getTime())
    )
    deadlineTimer.unref()
    observability.log({ name: "episode.started" })
    try {
      await raceWithSignal(
        observability.withSpan(
          "episode.process",
          {},
          () => this.runPipeline(job, observability, controller.signal),
          job.traceContext ? { link: job.traceContext } : undefined
        ),
        controller.signal
      )
      observability.count("episode.succeeded")
      observability.log({ name: "episode.succeeded" })
    } catch (error) {
      const effectiveError = controller.signal.aborted
        ? controller.signal.reason
        : error
      if (effectiveError instanceof LeaseLostError) {
        observability.log({
          name: "episode.failed",
          level: "warn",
          error: effectiveError,
        })
        return
      }
      const failure = classifyFailure(effectiveError)
      const delay = RETRY_DELAYS_MS[job.attempt - 1]
      const willRetry = failure.retryable && delay !== undefined
      try {
        if (willRetry) {
          store.retryJob(
            job.id,
            job.leaseToken,
            new Date(Date.now() + delay),
            failure
          )
        } else {
          store.failJob(job.id, job.leaseToken, failure)
          store.enqueueAudioChunkCleanup(job.id, "terminal-failure")
        }
      } catch (transitionError) {
        if (!(transitionError instanceof LeaseLostError)) throw transitionError
      }
      observability.count("episode.failed")
      observability.log({
        name: willRetry ? "episode.retrying" : "episode.failed",
        level: willRetry ? "warn" : "error",
        attributes: { "error.retryable": failure.retryable },
        error: effectiveError,
      })
    } finally {
      clearInterval(leaseMonitor)
      clearTimeout(deadlineTimer)
      observability.measure("episode.duration", performance.now() - startedAt)
    }
  }

  private async runPipeline(
    job: WorkerJob,
    observability: Observability,
    signal: AbortSignal
  ): Promise<void> {
    const feedIds = this.dependencies.store
      .getJobFeeds(job.id)
      .map((feed) => feed.id)
    const draftInputHash = hashJson({
      feedIds,
      generationPolicyHash: job.generationPolicyHash,
    })
    let draft
    try {
      draft = this.dependencies.store.getDraftCheckpoint(job.id, draftInputHash)
    } catch (error) {
      throw new CheckpointCorruptionError(
        error instanceof Error ? error.message : "Draft checkpoint is corrupt"
      )
    }
    if (!draft) {
      draft = await this.stage(
        job,
        "researching_sources",
        observability,
        signal,
        EPISODE_EXECUTION_POLICY.agentDeadlineMs,
        async (stageSignal) => {
          const generated = await this.dependencies.agent.run({
            jobId: job.id,
            ownerId: job.ownerId,
            feedIds,
            signal: stageSignal,
          })
          this.dependencies.store.saveDraftCheckpoint(job.id, job.leaseToken, {
            inputHash: draftInputHash,
            ...generated,
          })
          return { inputHash: draftInputHash, ...generated }
        }
      )
    }
    const sources = this.dependencies.store.resolveEpisodeSources(
      job.ownerId,
      draft.sourceUrls
    )
    const wave = await this.stage(
      job,
      "synthesizing_audio",
      observability,
      signal,
      EPISODE_EXECUTION_POLICY.ttsDeadlineMs,
      (stageSignal) => this.synthesizeWithCheckpoints(job, draft!, stageSignal)
    )
    await this.stage(
      job,
      "storing_episode",
      observability,
      signal,
      EPISODE_EXECUTION_POLICY.storeDeadlineMs,
      async (stageSignal) => {
        const episodeId = randomUUID()
        const stored = await this.dependencies.audio.put(
          job.ownerId,
          episodeId,
          wave,
          stageSignal
        )
        try {
          this.dependencies.store.completeJob({
            jobId: job.id,
            episodeId,
            ownerId: job.ownerId,
            leaseToken: job.leaseToken,
            title: draft.title,
            script: draft.script,
            audioKey: stored.key,
            audioByteLength: stored.byteLength,
            sources,
          })
        } catch (error) {
          if (this.dependencies.objects) {
            await this.dependencies.objects
              .delete(stored.key)
              .catch(() => undefined)
          }
          throw error
        }
        this.dependencies.store.enqueueAudioChunkCleanup(
          job.id,
          "episode-complete"
        )
      }
    )
  }

  private async synthesizeWithCheckpoints(
    job: WorkerJob,
    draft: { readonly script: string; readonly inputHash: string },
    signal: AbortSignal
  ): Promise<Uint8Array> {
    const chunks = splitSpeech(draft.script)
    const inputHash = hashJson({
      draft: draft.inputHash,
      script: sha256(new TextEncoder().encode(draft.script)),
      voice: this.dependencies.voice,
    })
    const saved = new Map(
      this.dependencies.store
        .listAudioChunkCheckpoints(job.id, inputHash)
        .map((checkpoint) => [checkpoint.position, checkpoint])
    )
    const waves: Uint8Array[] = []
    for (const [position, text] of chunks.entries()) {
      signal.throwIfAborted()
      const checkpoint = saved.get(position)
      let wave: Uint8Array | undefined
      if (checkpoint && this.dependencies.objects) {
        const object = await this.dependencies.objects.get(
          checkpoint.objectKey,
          signal
        )
        if (
          object &&
          object.byteLength === checkpoint.byteLength &&
          sha256(object.body) === checkpoint.contentHash &&
          isWave(object.body)
        ) {
          wave = object.body
        }
      }
      if (!wave) {
        wave = await this.dependencies.speech.synthesize(
          { text, ...this.dependencies.voice },
          signal
        )
        if (
          wave.byteLength > EPISODE_EXECUTION_POLICY.maximumChunkBytes ||
          !isWave(wave)
        ) {
          throw new CheckpointCorruptionError("Invalid VOICEVOX WAV chunk")
        }
        if (this.dependencies.objects) {
          const objectKey = `episode-jobs/${job.ownerId}/${job.id}/tts/${inputHash}/${position}.wav`
          await this.dependencies.objects.put({
            key: objectKey,
            body: wave,
            contentType: "audio/wav",
            signal,
          })
          try {
            this.dependencies.store.saveAudioChunkCheckpoint(
              job.id,
              job.leaseToken,
              inputHash,
              {
                position,
                objectKey,
                contentHash: sha256(wave),
                byteLength: wave.byteLength,
              }
            )
          } catch (error) {
            await this.dependencies.objects
              .delete(objectKey)
              .catch(() => undefined)
            throw error
          }
        }
      }
      waves.push(wave)
      this.dependencies.store.setJobProgress(
        job.id,
        job.leaseToken,
        position + 1,
        chunks.length
      )
    }
    const merged = mergeWaves(waves)
    if (merged.byteLength > EPISODE_EXECUTION_POLICY.maximumAudioBytes) {
      throw new CheckpointCorruptionError("Final audio exceeded 128 MiB")
    }
    return merged
  }

  private async stage<T>(
    job: WorkerJob,
    stage: JobStage,
    observability: Observability,
    signal: AbortSignal,
    deadlineMs: number,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.dependencies.store.setJobStage(job.id, job.leaseToken, stage)
    const startedAt = performance.now()
    try {
      const result = await withDeadline(
        (stageSignal) =>
          observability.withSpan(
            `episode.${stage}`,
            { "operation.stage": stage },
            () => operation(stageSignal)
          ),
        signal,
        deadlineMs,
        new StageDeadlineExceededError(stage)
      )
      observability.log({
        name: "episode.stage.completed",
        attributes: { "operation.stage": stage },
      })
      return result
    } finally {
      observability.measure(
        "episode.stage.duration",
        performance.now() - startedAt
      )
    }
  }
}

export function createLiveProcessor(input: {
  readonly store: LocalStore
  readonly objects: ObjectStore
  readonly openAi: ConstructorParameters<typeof OpenAiPodcastAgent>[0]
  readonly voicevox: ConstructorParameters<typeof VoicevoxSpeechSynthesizer>[0]
  readonly observability?: Observability
}): EpisodeProcessor {
  return new EpisodeProcessor({
    store: input.store,
    audio: new ObjectAudioStore(input.objects),
    agent: new OpenAiPodcastAgent(
      input.openAi,
      {
        listArticles: ({ ownerId, feedIds, limit }) =>
          Promise.resolve(
            input.store
              .listAgentArticles(ownerId, feedIds, limit)
              .map((item) => ({
                id: item.id,
                snapshotId: item.snapshotId!,
                feedId: item.feedId,
                sourceName: item.sourceName,
                title: item.title,
                url: new URL(item.url),
                ...(item.publishedAt
                  ? { publishedAt: new Date(item.publishedAt) }
                  : {}),
                ...(item.summary ? { summary: item.summary } : {}),
              }))
          ),
        readArticle: async ({ ownerId, articleId }) => {
          const item = input.store.getArticle(ownerId, articleId)
          const stored = input.store.getArticleObject(
            ownerId,
            articleId,
            "markdown"
          )
          if (!item?.snapshotId || !stored) throw new Error("article-not-found")
          const object = await input.objects.get(stored.key)
          if (!object) throw new Error("article-object-not-found")
          return {
            article: {
              id: item.id,
              snapshotId: item.snapshotId,
              feedId: item.feedId,
              sourceName: item.sourceName,
              title: item.title,
              url: new URL(item.url),
              ...(item.publishedAt
                ? { publishedAt: new Date(item.publishedAt) }
                : {}),
              ...(item.summary ? { summary: item.summary } : {}),
            },
            markdown: new TextDecoder().decode(object.body),
          }
        },
      },
      {
        start: (value) => input.store.startAgentRun(value),
        tool: (value) => input.store.recordAgentToolCall(value),
        finish: (runId, failureCode) =>
          input.store.finishAgentRun(runId, failureCode),
      }
    ),
    speech: new VoicevoxSpeechSynthesizer(input.voicevox),
    objects: input.objects,
    voice: {
      characterName: input.voicevox.characterName,
      ...(input.voicevox.styleName
        ? { styleName: input.voicevox.styleName }
        : {}),
    },
    ...(input.observability ? { observability: input.observability } : {}),
  })
}

export function createFakeProcessor(
  store: LocalStore,
  audioDirectory: string,
  observability: Observability = noopObservability
): EpisodeProcessor {
  const item: RssSourceItem = {
    sourceName: "開発ニュース",
    title: "ローカルE2Eニュース",
    url: new URL("https://example.com/local-news"),
    publishedAt: new Date(),
    description: "契約準拠fake providerによるローカル確認用ニュースです。",
  }
  return new EpisodeProcessor({
    store,
    audio: new LocalAudioStore(audioDirectory),
    agent: {
      run: ({ feedIds }) => {
        const feedId = feedIds[0]
        if (feedId) {
          store.upsertFeedItems(feedId, [
            {
              externalId: "local-e2e-news",
              title: item.title,
              url: item.url.href,
              ...(item.publishedAt
                ? { publishedAt: item.publishedAt.toISOString() }
                : {}),
              ...(item.description ? { summary: item.description } : {}),
            },
          ])
        }
        return Promise.resolve({
          title: "今日の開発ニュース",
          script:
            "開発ニュースからお伝えします。ローカル環境の生成パイプラインが正常に完了しました。",
          sourceUrls: [item.url],
        })
      },
    },
    speech: { synthesize: () => Promise.resolve(silentWave()) },
    voice: { characterName: "ずんだもん" },
    observability,
  })
}

function classifyFailure(error: unknown) {
  if (error instanceof JobDeadlineExceededError) {
    return {
      code: "job-deadline-exceeded",
      message: error.message,
      retryable: false,
    }
  }
  if (error instanceof StageDeadlineExceededError) {
    return { code: "provider-timeout", message: error.message, retryable: true }
  }
  if (error instanceof CheckpointCorruptionError) {
    return {
      code: "checkpoint-corruption",
      message: error.message,
      retryable: false,
    }
  }
  const retryable =
    (error instanceof PodcastAgentError && error.retryable) ||
    error instanceof VoicevoxProviderError
  return {
    code: retryable ? "provider-unavailable" : "pipeline-input-invalid",
    message: error instanceof Error ? error.message : "Unknown pipeline error",
    retryable,
  }
}

class JobDeadlineExceededError extends Error {
  constructor() {
    super("Episode generation exceeded the 30 minute deadline")
    this.name = "JobDeadlineExceededError"
  }
}

class StageDeadlineExceededError extends Error {
  constructor(stage: JobStage) {
    super(`Episode stage exceeded its deadline: ${stage}`)
    this.name = "StageDeadlineExceededError"
  }
}

class CheckpointCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckpointCorruptionError"
  }
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
  timeoutError: Error
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  timer.unref()
  try {
    const signal = AbortSignal.any([parent, controller.signal])
    return await raceWithSignal(operation(signal), signal)
  } finally {
    clearTimeout(timer)
  }
}

function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    )
  })
}

function splitSpeech(text: string, maximumLength = 500): readonly string[] {
  const sentences = text
    .split(/(?<=[。！？!?])/u)
    .map((value) => value.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    if (sentence.length > maximumLength) {
      for (let offset = 0; offset < sentence.length; offset += maximumLength) {
        chunks.push(sentence.slice(offset, offset + maximumLength))
      }
      continue
    }
    const previous = chunks.at(-1)
    if (previous && previous.length + sentence.length <= maximumLength) {
      chunks[chunks.length - 1] = previous + sentence
    } else {
      chunks.push(sentence)
    }
  }
  if (chunks.length === 0)
    throw new CheckpointCorruptionError("Speech text is empty")
  return chunks
}

function mergeWaves(waves: readonly Uint8Array[]): Uint8Array {
  if (waves.length === 0) throw new CheckpointCorruptionError("No WAV chunks")
  if (waves.length === 1) return waves[0]!
  const parts = waves.map((wave) => {
    const offset = findWaveChunk(wave, "data")
    const size = readWaveUint32(wave, offset + 4)
    return wave.slice(offset + 8, offset + 8 + size)
  })
  const first = waves[0]!
  const dataOffset = findWaveChunk(first, "data")
  const header = first.slice(0, dataOffset + 8)
  const dataLength = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(header.length + dataLength)
  result.set(header)
  let offset = header.length
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  view.setUint32(4, result.length - 8, true)
  view.setUint32(dataOffset + 4, dataLength, true)
  return result
}

function isWave(value: Uint8Array): boolean {
  try {
    return (
      decodeFourCc(value, 0) === "RIFF" &&
      decodeFourCc(value, 8) === "WAVE" &&
      findWaveChunk(value, "data") >= 12
    )
  } catch {
    return false
  }
}

function findWaveChunk(value: Uint8Array, name: string): number {
  for (let offset = 12; offset + 8 <= value.length;) {
    if (decodeFourCc(value, offset) === name) return offset
    const size = readWaveUint32(value, offset + 4)
    offset += 8 + size + (size % 2)
  }
  throw new CheckpointCorruptionError(`WAV response is missing ${name} chunk`)
}

function decodeFourCc(value: Uint8Array, offset: number): string {
  if (offset + 4 > value.length)
    throw new CheckpointCorruptionError("Invalid WAV")
  return new TextDecoder().decode(value.slice(offset, offset + 4))
}

function readWaveUint32(value: Uint8Array, offset: number): number {
  if (offset + 4 > value.length)
    throw new CheckpointCorruptionError("Invalid WAV")
  return new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength
  ).getUint32(offset, true)
}

function hashJson(value: unknown): string {
  return sha256(new TextEncoder().encode(JSON.stringify(value)))
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function silentWave(): Uint8Array {
  const sampleCount = 8_000
  const result = new Uint8Array(44 + sampleCount * 2)
  const view = new DataView(result.buffer)
  result.set(new TextEncoder().encode("RIFF"), 0)
  view.setUint32(4, result.length - 8, true)
  result.set(new TextEncoder().encode("WAVEfmt "), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true)
  view.setUint32(28, 16_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  result.set(new TextEncoder().encode("data"), 36)
  view.setUint32(40, sampleCount * 2, true)
  return result
}
