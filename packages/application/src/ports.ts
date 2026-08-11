import type {
  AgentMemoryKind,
  AgentMemoryStatus,
  AgentRunStatus,
  JobStatus,
} from "@news-podcast/domain"

export interface AgentEvent {
  readonly schemaVersion: 1
  readonly runId: string
  readonly sequence: number
  readonly type: string
  readonly occurredAt: Date
  readonly payload: Readonly<Record<string, unknown>>
}

export interface AgentEngineCheckpoint {
  readonly schemaVersion: 1
  readonly engine: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface AgentEngine {
  run(input: {
    readonly runId: string
    readonly goal: string
    readonly checkpoint?: AgentEngineCheckpoint
    readonly signal?: AbortSignal
  }): Promise<{ readonly events: readonly AgentEvent[] }>
}

export interface SandboxLimits {
  readonly vcpuCount: number
  readonly memoryMib: number
  readonly diskMib: number
  readonly wallTimeSeconds: number
  readonly outputBytes: number
}

export interface SandboxSession {
  readonly id: string
  readonly state: "ready" | "stopped"
}

export interface SandboxClient {
  create(input: {
    readonly runId: string
    readonly profile: string
    readonly limits: SandboxLimits
  }): Promise<SandboxSession>
  exec(input: {
    readonly sessionId: string
    readonly command: readonly string[]
    readonly workingDirectory: string
    readonly timeoutSeconds: number
  }): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly truncated: boolean
  }>
  checkpoint(sessionId: string): Promise<{ readonly objectKey: string }>
  destroy(sessionId: string): Promise<void>
}

export interface AgentMemoryRecord {
  readonly id: string
  readonly ownerId: string
  readonly agentInstanceId: string
  readonly kind: AgentMemoryKind
  readonly status: AgentMemoryStatus
  readonly version: number
  readonly content: Readonly<Record<string, unknown>>
  readonly createdAt: Date
  readonly expiresAt?: Date
}

export interface AgentMemoryRepository {
  listActive(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
  }): Promise<readonly AgentMemoryRecord[]>
  propose(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
    readonly kind: AgentMemoryKind
    readonly content: Readonly<Record<string, unknown>>
    readonly expiresAt?: Date
  }): Promise<AgentMemoryRecord>
  decide(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
    readonly memoryId: string
    readonly decision: "approve" | "reject"
  }): Promise<AgentMemoryRecord | null>
}

export interface AgentRunRecord {
  readonly id: string
  readonly jobId: string
  readonly ownerId: string
  readonly status: AgentRunStatus
  readonly policyHash: string
  readonly createdAt: Date
}

export interface AgentRunRepository {
  get(ownerId: string, runId: string): Promise<AgentRunRecord | null>
  transition(input: {
    readonly ownerId: string
    readonly runId: string
    readonly expected: AgentRunStatus
    readonly next: AgentRunStatus
  }): Promise<boolean>
  appendEvent(event: AgentEvent): Promise<void>
}

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
  synthesize(request: SpeechRequest, signal?: AbortSignal): Promise<Uint8Array>
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
    readonly signal?: AbortSignal
  }): Promise<StoredObject>
  get(
    key: string,
    signal?: AbortSignal
  ): Promise<{
    readonly body: Uint8Array
    readonly contentType: string
    readonly byteLength: number
  } | null>
  delete(key: string, signal?: AbortSignal): Promise<void>
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
    /** 指定時はこの記事だけが候補になり、limit と新着順は無視される。 */
    readonly articleIds?: readonly string[]
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
    /** ユーザーが明示選択した記事。空なら全自動選択。 */
    readonly articleIds?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<EpisodeScriptDraft>
}

export interface AudioStore {
  put(
    ownerId: string,
    episodeId: string,
    audio: Uint8Array,
    signal?: AbortSignal
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
    readonly articleIds?: readonly string[]
    readonly traceContext?: EpisodeTraceContext
  }): Promise<EpisodeJobRecord>
}

// --- AI補助（要約・適合度スコア）関連のポート ---
// 要約は記事本文にのみ依存する（所有者非依存）。スコアは所有者の興味プロフィールに
// 依存するため、生成器を別インターフェースに分ける。

export interface ProviderUsage {
  readonly tokensIn: number
  readonly tokensOut: number
}

export interface ArticleSummaryInput {
  readonly title: string
  readonly markdown: string
}

export interface ArticleSummaryResult extends ProviderUsage {
  // 日本語の箇条書き3点。
  readonly bullets: readonly string[]
}

export interface ArticleSummarizer {
  summarize(
    input: ArticleSummaryInput,
    signal?: AbortSignal
  ): Promise<ArticleSummaryResult>
}

export interface InterestProfile {
  readonly include: string
  readonly exclude: string
}

export interface RelevanceCandidate {
  readonly feedItemId: string
  readonly title: string
  readonly bullets: readonly string[]
}

export interface RelevanceScore {
  readonly feedItemId: string
  readonly score: number
  readonly reason: string
  // 利用者が定義した語彙(tagVocabulary)の中からAIが選んだタグ名のみ。自由生成はさせない。
  readonly tags: readonly string[]
  // 語彙に無いが付けたかったタグ名。tag_suggestionsへ溜めてUIの「このタグを作る」導線に使う。
  readonly suggestedTags: readonly string[]
}

export interface RelevanceBatchResult extends ProviderUsage {
  readonly scores: readonly RelevanceScore[]
}

export interface ArticleRelevanceScorer {
  score(
    input: {
      readonly profile: InterestProfile
      readonly candidates: readonly RelevanceCandidate[]
      // タグ付与の候補語彙。空配列なら構造化出力からタグ関連フィールドを外し
      // タグ付与自体をスキップする（enumが空だと構造化出力スキーマが壊れるため）。
      readonly tagVocabulary: readonly string[]
    },
    signal?: AbortSignal
  ): Promise<RelevanceBatchResult>
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
