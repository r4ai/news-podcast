import { createHash, randomUUID } from "node:crypto"

import { LocalAudioStore } from "@news-podcast/adapters/audio/local"
import { ObjectAudioStore } from "@news-podcast/adapters/audio/object"
import { LeaseLostError } from "@news-podcast/adapters/db/local"
import type {
  JobStage,
  LocalStore,
  WorkerJob,
} from "@news-podcast/adapters/db/local"
import type { OpenAiConfig } from "@news-podcast/adapters/config"
import { PodcastAgentError } from "@news-podcast/adapters/openai-agent"
import { SectionalOpenAiPodcastAgent } from "@news-podcast/adapters/sectional-openai-agent"
import type { AgentAudit } from "@news-podcast/adapters/openai-agent"
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
import { createTracedFetch } from "@news-podcast/observability/node"

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
  readonly openAi?: OpenAiConfig
  readonly voicevoxBaseUrl?: URL
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
          observability.count("episode.lease.renewed")
          observability.log({
            name: "episode.lease.renewed",
            level: "debug",
            attributes: {
              ...jobAttributes(job),
              "lease.result": "renewed",
            },
          })
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
    observability.count("episode.started", 1, {
      "job.attempt": job.attempt,
      "job.max_attempts": 4,
    })
    observability.log({
      name: "episode.started",
      attributes: jobAttributes(job),
    })
    if (job.recovered) {
      observability.count("episode.lease.recovered")
      observability.log({
        name: "episode.lease.recovered",
        level: "warn",
        attributes: { ...jobAttributes(job), "lease.result": "recovered" },
      })
    }
    try {
      await raceWithSignal(
        observability.withSpan(
          "episode.process",
          jobAttributes(job),
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
        observability.count("episode.lease.lost")
        observability.log({
          name: "episode.lease.lost",
          level: "warn",
          attributes: { ...jobAttributes(job), "lease.result": "lost" },
          error: effectiveError,
        })
        return
      }
      const classifiedFailure = classifyFailure(effectiveError)
      const delay = RETRY_DELAYS_MS[job.attempt - 1]
      const attemptLimitReached =
        classifiedFailure.retryable && delay === undefined
      const failure = attemptLimitReached
        ? {
            code: "attempt-limit-exceeded",
            message: "Automatic generation reached the four-attempt limit",
            retryable: true,
          }
        : classifiedFailure
      if (failure.code === "job-deadline-exceeded") {
        observability.count("episode.deadline.exceeded")
        observability.log({
          name: "episode.deadline.exceeded",
          level: "error",
          attributes: jobAttributes(job),
          error: effectiveError,
        })
      }
      const willRetry = failure.retryable && delay !== undefined
      if (attemptLimitReached) {
        observability.count("episode.attempt_limit.exceeded")
      }
      try {
        if (willRetry) {
          store.retryJob(
            job.id,
            job.leaseToken,
            new Date(Date.now() + delay),
            failure
          )
          observability.count("episode.retry", 1, {
            "job.attempt": job.attempt,
            "failure.code": failure.code,
          })
        } else {
          store.failJob(job.id, job.leaseToken, failure)
          store.enqueueAudioChunkCleanup(job.id, "terminal-failure")
          observability.count("episode.failed", 1, {
            "failure.code": failure.code,
          })
        }
      } catch (transitionError) {
        if (!(transitionError instanceof LeaseLostError)) throw transitionError
        observability.count("episode.lease.lost")
        observability.log({
          name: "episode.lease.lost",
          level: "warn",
          attributes: { ...jobAttributes(job), "lease.result": "lost" },
          error: transitionError,
        })
        return
      }
      observability.log({
        name: willRetry ? "episode.retrying" : "episode.failed",
        level: willRetry ? "warn" : "error",
        attributes: {
          ...jobAttributes(job),
          "error.retryable": failure.retryable,
          "failure.code": failure.code,
        },
        error: effectiveError,
      })
    } finally {
      clearInterval(leaseMonitor)
      clearTimeout(deadlineTimer)
      observability.measure("episode.duration", performance.now() - startedAt, {
        "job.attempt": job.attempt,
      })
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
    // 選択記事は台本の中身を決めるので、チェックポイントの入力ハッシュに
    // 含めないと選択違いのジョブが他人のドラフトを誤ってヒットさせる。
    const articleIds = this.dependencies.store.listJobArticleIds(job.id)
    const draftInputHash = hashJson({
      feedIds,
      articleIds,
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
      observability.count("episode.checkpoint", 1, {
        "checkpoint.result": "miss",
        "operation.stage": "generating_script",
      })
      observability.log({
        name: "episode.checkpoint",
        attributes: {
          ...jobAttributes(job),
          "checkpoint.result": "miss",
          "operation.stage": "generating_script",
        },
      })
      draft = await this.stage(
        job,
        "researching_sources",
        observability,
        signal,
        EPISODE_EXECUTION_POLICY.agentDeadlineMs,
        async (stageSignal) => {
          const generated = await providerOperation(
            observability,
            job,
            "openai",
            "agent.run",
            stageSignal,
            () =>
              this.dependencies.agent.run({
                jobId: job.id,
                ownerId: job.ownerId,
                feedIds,
                ...(articleIds.length > 0 ? { articleIds } : {}),
                signal: stageSignal,
              })
          )
          this.dependencies.store.saveDraftCheckpoint(job.id, job.leaseToken, {
            inputHash: draftInputHash,
            ...generated,
          })
          return { inputHash: draftInputHash, ...generated }
        }
      )
    } else {
      observability.count("episode.checkpoint", 1, {
        "checkpoint.result": "hit",
        "operation.stage": "generating_script",
      })
      observability.log({
        name: "episode.checkpoint",
        attributes: {
          ...jobAttributes(job),
          "checkpoint.result": "hit",
          "operation.stage": "generating_script",
        },
      })
    }
    await this.extractReadingTerms(job, draft!, observability, signal).catch(
      () => undefined,
    )
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
      (stageSignal) =>
        this.synthesizeWithCheckpoints(job, draft!, observability, stageSignal)
    )
    await this.stage(
      job,
      "storing_episode",
      observability,
      signal,
      EPISODE_EXECUTION_POLICY.storeDeadlineMs,
      async (stageSignal) => {
        const episodeId = randomUUID()
        const stored = await providerOperation(
          observability,
          job,
          "object-store",
          "episode.put",
          stageSignal,
          () =>
            this.dependencies.audio.put(
              job.ownerId,
              episodeId,
              wave,
              stageSignal
            )
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
    observability: Observability,
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
      let reused = false
      if (checkpoint && this.dependencies.objects) {
        const object = await providerOperation(
          observability,
          job,
          "object-store",
          "checkpoint.get",
          signal,
          () => this.dependencies.objects!.get(checkpoint.objectKey, signal)
        )
        if (
          object &&
          object.byteLength === checkpoint.byteLength &&
          sha256(object.body) === checkpoint.contentHash &&
          isWave(object.body)
        ) {
          wave = object.body
          reused = true
          observability.count("episode.checkpoint", 1, {
            "checkpoint.result": "hit",
            "operation.stage": "synthesizing_audio",
          })
        }
      }
      if (!wave) {
        observability.count("episode.checkpoint", 1, {
          "checkpoint.result": checkpoint ? "corruption" : "miss",
          "operation.stage": "synthesizing_audio",
        })
        const providerStartedAt = performance.now()
        let providerOutcome = "succeeded"
        try {
          wave = await this.dependencies.speech.synthesize(
            { text, ...this.dependencies.voice },
            signal
          )
        } catch (error) {
          providerOutcome =
            signal.aborted || isProviderTimeout(error) ? "timeout" : "error"
          throw error
        } finally {
          const providerAttributes = {
            "provider.name": "voicevox",
            "provider.operation": "synthesis",
            "provider.outcome": providerOutcome,
          } as const
          observability.count("provider.request", 1, providerAttributes)
          observability.measure(
            "provider.request.duration",
            performance.now() - providerStartedAt,
            providerAttributes
          )
          observability.log({
            name: "provider.request",
            level: providerOutcome === "succeeded" ? "info" : "error",
            attributes: { ...jobAttributes(job), ...providerAttributes },
          })
        }
        if (
          wave.byteLength > EPISODE_EXECUTION_POLICY.maximumChunkBytes ||
          !isWave(wave)
        ) {
          throw new CheckpointCorruptionError("Invalid VOICEVOX WAV chunk")
        }
        if (this.dependencies.objects) {
          const objectKey = `episode-jobs/${job.ownerId}/${job.id}/tts/${inputHash}/${position}.wav`
          await providerOperation(
            observability,
            job,
            "object-store",
            "checkpoint.put",
            signal,
            () =>
              this.dependencies.objects!.put({
                key: objectKey,
                body: wave!,
                contentType: "audio/wav",
                signal,
              })
          )
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
      observability.count("episode.audio.chunk", 1, {
        "checkpoint.result": reused ? "reused" : "generated",
      })
      this.dependencies.store.setJobProgress(
        job.id,
        job.leaseToken,
        position + 1,
        chunks.length
      )
      this.dependencies.store.appendJobEvent({
        jobId: job.id,
        eventType: "tts.progress",
        attempt: job.attempt,
        stage: "synthesizing_audio",
        payload: { completed: position + 1, total: chunks.length },
      })
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
    this.dependencies.store.appendJobEvent({
      jobId: job.id,
      eventType: "stage.started",
      attempt: job.attempt,
      stage,
    })
    const startedAt = performance.now()
    try {
      const result = await withDeadline(
        (stageSignal) =>
          observability.withSpan(
            `episode.${stage}`,
            { ...jobAttributes(job), "operation.stage": stage },
            () => operation(stageSignal)
          ),
        signal,
        deadlineMs,
        new StageDeadlineExceededError(stage)
      )
      observability.log({
        name: "episode.stage.completed",
        attributes: { ...jobAttributes(job), "operation.stage": stage },
      })
      // storing_episode の本体で completeJob が走るので、この時点で既に
      // job.succeeded を追記済みのことがある。終端イベントの後に
      // stage.finished を流すとクライアントの「完了」判定より後ろに
      // イベントが続いてしまうため、終端後は追記しない。
      if (!this.isTerminal(job)) {
        this.dependencies.store.appendJobEvent({
          jobId: job.id,
          eventType: "stage.finished",
          attempt: job.attempt,
          stage,
        })
      }
      return result
    } finally {
      observability.measure(
        "episode.stage.duration",
        performance.now() - startedAt,
        { "operation.stage": stage }
      )
    }
  }

  private isTerminal(job: WorkerJob): boolean {
    const status = this.dependencies.store.getJob(job.ownerId, job.id)?.status
    return (
      status === "succeeded" || status === "failed" || status === "canceled"
    )
  }

  private async extractReadingTerms(
    job: WorkerJob,
    draft: { script: string; inputHash: string },
    observability: Observability,
    signal: AbortSignal,
  ): Promise<void> {
    const config = this.dependencies.openAi
    if (!config) return

    const existing = new Set(
      this.dependencies.store
        .listReadingDictionary(job.ownerId)
        .map((e) => e.surface),
    )

    const terms = await extractTermsFromScript(draft.script, config, signal)
    const newTerms: TermReading[] = []
    for (const term of terms) {
      if (existing.has(term.surface)) continue
      newTerms.push(term)
    }

    if (newTerms.length === 0) return

    const baseUrl = this.dependencies.voicevoxBaseUrl
    for (const term of newTerms) {
      let wordUuid: string | null = null
      if (baseUrl) {
        try {
          wordUuid = await addVoicevoxWord(
            baseUrl,
            term.surface,
            term.reading,
            term.accentType,
            signal,
          )
        } catch {
          // VOICEVOX unavailable; persist locally only
        }
      }
      const entry = this.dependencies.store.addReadingDictionary({
        ownerId: job.ownerId,
        surface: term.surface,
        reading: term.reading,
        accentType: term.accentType,
        source: "ai_auto",
        episodeJobId: job.id,
      })
      if (wordUuid) {
        this.dependencies.store.updateReadingDictionary(job.ownerId, entry.id, {
          wordUuid,
        })
      }
      existing.add(term.surface)
      observability.log({
        name: "reading_dictionary.term_added",
        attributes: {
          ...jobAttributes(job),
          "term.surface": term.surface,
          "term.reading": term.reading,
        },
      })
    }
  }
}

/**
 * 監査（agent_runs / agent_tool_calls）と進捗ストリーム（episode_job_events）の
 * 両方に書く AgentAudit。ツール呼び出し時点では runId しか渡ってこないので、
 * start で受け取ったジョブの情報をここで保持する。
 */
function createAgentAudit(store: LocalStore): AgentAudit {
  const runs = new Map<string, { jobId: string; attempt: number }>()
  const append = (
    runId: string,
    eventType: string,
    payload: Readonly<Record<string, unknown>>
  ): void => {
    const run = runs.get(runId)
    if (!run) return
    store.appendJobEvent({
      jobId: run.jobId,
      eventType,
      attempt: run.attempt,
      stage: "researching_sources",
      payload,
    })
  }
  return {
    start: (value) => {
      const runId = store.startAgentRun(value)
      runs.set(runId, {
        jobId: value.jobId,
        attempt: store.getJob(value.ownerId, value.jobId)?.attempt ?? 0,
      })
      return runId
    },
    tool: (value) => {
      store.recordAgentToolCall(value)
      append(value.runId, "agent.tool_call", {
        position: value.position,
        name: value.name,
        arguments: value.argumentsJson,
        outputSummary: value.outputSummary,
      })
    },
    articleAdopted: (value) => {
      append(value.runId, "agent.article_adopted", {
        articleId: value.articleId,
        title: value.title,
        url: value.url,
        sourceName: value.sourceName,
      })
    },
    finish: (runId, failureCode) => {
      store.finishAgentRun(runId, failureCode)
      runs.delete(runId)
    },
  }
}

export function createLiveProcessor(input: {
  readonly store: LocalStore
  readonly objects: ObjectStore
  readonly openAi: OpenAiConfig
  readonly voicevox: ConstructorParameters<typeof VoicevoxSpeechSynthesizer>[0]
  readonly observability?: Observability
}): EpisodeProcessor {
  const observability = input.observability ?? noopObservability
  const openAiFetch = createTracedFetch({
    provider: "openai",
    operation: "responses",
  })
  const voicevoxFetch = createTracedFetch({
    provider: "voicevox",
    operation: (url) => voicevoxOperation(url),
  })
  return new EpisodeProcessor({
    store: input.store,
    audio: new ObjectAudioStore(input.objects),
    agent: new SectionalOpenAiPodcastAgent(
      input.openAi,
      {
        listArticles: ({ ownerId, feedIds, limit, articleIds }) =>
          Promise.resolve(
            input.store
              .listAgentArticles(ownerId, feedIds, limit, articleIds)
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
      createAgentAudit(input.store),
      openAiFetch
    ),
    speech: new VoicevoxSpeechSynthesizer(input.voicevox, voicevoxFetch),
    objects: input.objects,
    voice: {
      characterName: input.voicevox.characterName,
      ...(input.voicevox.styleName
        ? { styleName: input.voicevox.styleName }
        : {}),
    },
    openAi: input.openAi,
    voicevoxBaseUrl: input.voicevox.baseUrl,
    observability,
  })
}

function voicevoxOperation(url: URL): string {
  const operation = url.pathname.split("/").filter(Boolean).at(-1)
  if (
    operation === "speakers" ||
    operation === "audio_query" ||
    operation === "synthesis"
  ) {
    return operation
  }
  return "request"
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
      run: ({ jobId, feedIds }) => {
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
        // 実行列を本番と揃える。揃えないと e2e とストーリーが実物と乖離する。
        const emit = (
          eventType: string,
          payload: Readonly<Record<string, unknown>>
        ) =>
          store.appendJobEvent({
            jobId,
            eventType,
            stage: "researching_sources",
            payload,
          })
        emit("agent.tool_call", {
          position: 0,
          name: "list_rss_articles",
          arguments: JSON.stringify({ limit: 20 }),
          outputSummary: { count: 1 },
        })
        emit("agent.tool_call", {
          position: 1,
          name: "read_article",
          arguments: JSON.stringify({ article_id: "local-e2e-news" }),
          outputSummary: { title: item.title },
        })
        emit("agent.article_adopted", {
          articleId: "local-e2e-news",
          title: item.title,
          url: item.url.href,
          sourceName: item.sourceName,
        })
        emit("agent.tool_call", {
          position: 2,
          name: "submit_episode_draft",
          arguments: JSON.stringify({ title: "今日の開発ニュース" }),
          outputSummary: { sourceCount: 1 },
        })
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

function jobAttributes(job: WorkerJob) {
  return {
    "job.id": job.id,
    "job.attempt": job.attempt,
    "job.max_attempts": 4,
  } as const
}

async function providerOperation<T>(
  observability: Observability,
  job: WorkerJob,
  provider: string,
  operation: string,
  signal: AbortSignal,
  execute: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  let outcome = "succeeded"
  try {
    return await execute()
  } catch (error) {
    outcome = signal.aborted || isProviderTimeout(error) ? "timeout" : "error"
    throw error
  } finally {
    const attributes = {
      "provider.name": provider,
      "provider.operation": operation,
      "provider.outcome": outcome,
    } as const
    observability.count("provider.request", 1, attributes)
    observability.measure(
      "provider.request.duration",
      performance.now() - startedAt,
      attributes
    )
    observability.log({
      name: "provider.request",
      level: outcome === "succeeded" ? "info" : "error",
      attributes: { ...jobAttributes(job), ...attributes },
    })
  }
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
  if (isProviderTimeout(error)) {
    return {
      code: "provider-timeout",
      message: error instanceof Error ? error.message : "Provider timed out",
      retryable: true,
    }
  }
  if (error instanceof PodcastAgentError) {
    return {
      code: error.retryable ? "provider-unavailable" : "pipeline-input-invalid",
      message: "Podcast generation failed",
      retryable: error.retryable,
    }
  }
  const retryable = error instanceof VoicevoxProviderError
  return {
    code: retryable ? "provider-unavailable" : "pipeline-input-invalid",
    message: error instanceof Error ? error.message : "Unknown pipeline error",
    retryable,
  }
}

function isProviderTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || /timed out|timeout/i.test(error.message))
  )
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

interface TermReading {
  readonly surface: string
  readonly reading: string
  readonly accentType: number
}

async function extractTermsFromScript(
  script: string,
  config: OpenAiConfig,
  signal: AbortSignal,
): Promise<readonly TermReading[]> {
  const prompt = [
    "以下のPodcast台本から、専門用語・固有名詞・英略語など、",
    "VOICEVOXが正しく読めない可能性がある単語を抽出し、正しいカタカナ読みを付けよ。",
    "一般的な日本語は不要。明らかに読み間違えそうな単語だけを対象とせよ。",
    "",
    "JSON形式で出力:",
    '[ { "surface": "GPT-5", "reading": "ジーピーティーファイブ", "accent_type": 6 } ]',
    "",
    "台本:",
    script,
  ].join("\n")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.model,
      instructions: "簡潔なJSONだけを出力せよ。説明や前置きは一切不要。",
      input: prompt,
    }),
  })

  if (!response.ok) return []

  const data = (await response.json()) as {
    output?: readonly { content?: readonly { text?: string }[] }[]
  }
  const text = data.output?.[0]?.content?.[0]?.text
  if (!text) return []

  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    return (JSON.parse(match[0]) as unknown[]).map((item) => {
      const obj = item as Record<string, unknown>
      return {
        surface: String(obj.surface ?? ""),
        reading: String(obj.reading ?? ""),
        accentType: Number(obj.accent_type ?? 0),
      }
    })
  } catch {
    return []
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

async function addVoicevoxWord(
  baseUrl: URL,
  surface: string,
  pronunciation: string,
  accentType: number,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL("user_dict_word", baseUrl)
  url.searchParams.set("surface", surface)
  url.searchParams.set("pronunciation", pronunciation)
  url.searchParams.set("accent_type", String(accentType))
  const response = await fetch(url, {
    method: "POST",
    signal,
  })
  if (!response.ok) {
    throw new Error(
      `VOICEVOX user_dict_word add failed with ${response.status}`,
    )
  }
  return (await response.text()).trim()
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
