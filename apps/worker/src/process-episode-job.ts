import { randomUUID } from "node:crypto"

import { LocalAudioStore } from "@news-podcast/adapters/audio/local"
import { ObjectAudioStore } from "@news-podcast/adapters/audio/object"
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

export interface EpisodeProcessorDependencies {
  readonly store: LocalStore
  readonly audio: AudioStore
  readonly agent: PodcastAgentRunner
  readonly speech: SpeechSynthesizer
  readonly voice: { characterName: string; styleName?: string }
  readonly observability?: Observability
}

export class EpisodeProcessor {
  constructor(private readonly dependencies: EpisodeProcessorDependencies) {}

  async process(job: WorkerJob, now = new Date()): Promise<void> {
    const { store } = this.dependencies
    const observability = this.dependencies.observability ?? noopObservability
    const startedAt = performance.now()
    observability.log({ name: "episode.started" })
    try {
      await observability.withSpan(
        "episode.process",
        {},
        () => this.runPipeline(job, now, observability),
        job.traceContext ? { link: job.traceContext } : undefined
      )
      observability.count("episode.succeeded")
      observability.log({ name: "episode.succeeded" })
    } catch (error) {
      const failure = classifyFailure(error)
      const delay = RETRY_DELAYS_MS[job.attempt - 1]
      const willRetry = failure.retryable && delay !== undefined
      if (willRetry) {
        store.retryJob(
          job.id,
          job.leaseToken,
          new Date(now.getTime() + delay),
          failure
        )
      } else {
        store.failJob(job.id, job.leaseToken, failure)
      }
      observability.count("episode.failed")
      observability.log({
        name: willRetry ? "episode.retrying" : "episode.failed",
        level: willRetry ? "warn" : "error",
        attributes: { "error.retryable": failure.retryable },
        error,
      })
    } finally {
      observability.measure("episode.duration", performance.now() - startedAt)
    }
  }

  private async runPipeline(
    job: WorkerJob,
    now: Date,
    observability: Observability
  ): Promise<void> {
    const feedIds = this.dependencies.store
      .getJobFeeds(job.id)
      .map((feed) => feed.id)
    const draft = await this.stage(
      job,
      "researching_sources",
      observability,
      () =>
        this.dependencies.agent.run({
          jobId: job.id,
          ownerId: job.ownerId,
          feedIds,
        })
    )
    const sources = this.dependencies.store.resolveEpisodeSources(
      job.ownerId,
      draft.sourceUrls
    )
    const wave = await this.stage(
      job,
      "synthesizing_audio",
      observability,
      () =>
        this.dependencies.speech.synthesize({
          text: draft.script,
          ...this.dependencies.voice,
        })
    )
    await this.stage(job, "storing_episode", observability, async () => {
      const episodeId = randomUUID()
      const stored = await this.dependencies.audio.put(
        job.ownerId,
        episodeId,
        wave
      )
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
    })
  }

  private async stage<T>(
    job: WorkerJob,
    stage: JobStage,
    observability: Observability,
    operation: () => Promise<T>
  ): Promise<T> {
    this.dependencies.store.setJobStage(job.id, job.leaseToken, stage)
    const startedAt = performance.now()
    try {
      const result = await observability.withSpan(
        `episode.${stage}`,
        { "operation.stage": stage },
        operation
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
  const retryable =
    (error instanceof PodcastAgentError && error.retryable) ||
    error instanceof VoicevoxProviderError
  return {
    code: retryable ? "provider-unavailable" : "pipeline-input-invalid",
    message: error instanceof Error ? error.message : "Unknown pipeline error",
    retryable,
  }
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
