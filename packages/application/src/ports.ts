import type { JobStatus } from "@news-podcast/domain"

export interface RssSourceItem {
  readonly sourceName: string
  readonly title: string
  readonly url: URL
  readonly publishedAt?: Date
  readonly description?: string
  readonly externalId?: string
}

export interface EpisodeScriptDraft {
  readonly title: string
  readonly script: string
  readonly sourceUrls: readonly URL[]
}

export interface SummaryGenerator {
  generate(items: readonly RssSourceItem[]): Promise<EpisodeScriptDraft>
}

export interface SpeechRequest {
  readonly text: string
  readonly characterName: string
  readonly styleName?: string
}

export interface SpeechSynthesizer {
  synthesize(request: SpeechRequest): Promise<Uint8Array>
}

export interface StoredAudio {
  readonly key: string
  readonly byteLength: number
}

export interface StoredObject {
  readonly key: string
  readonly byteLength: number
  readonly contentType: string
}

export interface ObjectStore {
  put(input: {
    readonly key: string
    readonly body: Uint8Array
    readonly contentType: string
  }): Promise<StoredObject>
  get(key: string): Promise<{
    readonly body: Uint8Array
    readonly contentType: string
    readonly byteLength: number
  } | null>
  delete(key: string): Promise<void>
}

export interface AgentArticle {
  readonly id: string
  readonly snapshotId: string
  readonly feedId: string
  readonly sourceName: string
  readonly title: string
  readonly url: URL
  readonly publishedAt?: Date
  readonly summary?: string
}

export interface PodcastAgentContext {
  listArticles(input: {
    readonly ownerId: string
    readonly feedIds: readonly string[]
    readonly limit: number
  }): Promise<readonly AgentArticle[]>
  readArticle(input: {
    readonly ownerId: string
    readonly articleId: string
  }): Promise<{ readonly article: AgentArticle; readonly markdown: string }>
}

export interface PodcastAgentRunner {
  run(input: {
    readonly jobId: string
    readonly ownerId: string
    readonly feedIds: readonly string[]
  }): Promise<EpisodeScriptDraft>
}

export interface AudioStore {
  put(
    ownerId: string,
    episodeId: string,
    audio: Uint8Array
  ): Promise<StoredAudio>
  createAccessUrl(
    ownerId: string,
    key: string,
    ttlSeconds: number
  ): Promise<URL>
}

export interface EpisodeJobMessage {
  readonly ownerId: string
  readonly jobId: string
  readonly traceContext?: EpisodeTraceContext
}

export interface EpisodeTraceContext {
  readonly traceParent: string
  readonly traceState?: string
}

export interface JobDispatcher {
  dispatch(message: EpisodeJobMessage): Promise<void>
}

export interface LeasedEpisodeJob extends EpisodeJobMessage {
  readonly status: JobStatus
  readonly leaseToken: string
}

export interface JobLeaseStore {
  leaseNext(now: Date, leaseSeconds: number): Promise<LeasedEpisodeJob | null>
}

export interface EnabledSubscriptionReader {
  listEnabledFeedIds(ownerId: string): Promise<readonly string[]>
}

export interface EpisodeJobRecord {
  readonly jobId: string
  readonly ownerId: string
  readonly createdAt: Date
  readonly created: boolean
}

export interface EpisodeJobRepository {
  create(input: {
    readonly ownerId: string
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly trigger: "manual" | "scheduled"
    readonly feedIds: readonly string[]
    readonly traceContext?: EpisodeTraceContext
  }): Promise<EpisodeJobRecord>
}

export interface GenerationSchedule {
  readonly enabled: boolean
  readonly localTime: string
  readonly timeZone: string
}

export interface UserSettingsRepository {
  get(ownerId: string): Promise<GenerationSchedule>
  set(
    ownerId: string,
    schedule: GenerationSchedule
  ): Promise<GenerationSchedule>
}
