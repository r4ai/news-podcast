import type { JobStatus } from "@news-podcast/domain"

export interface RssSourceItem {
  readonly title: string
  readonly url: URL
  readonly publishedAt?: Date
  readonly description?: string
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
