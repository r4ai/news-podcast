/**
 * episode_jobs 集約に対する永続化操作の型。
 * 実装は adapters/persistence/job/handle.ts にある。
 */

export type StoredJobRow = Readonly<{
  requestFingerprint: string
  document: string
}>

export type LeasedJobRow = Readonly<{
  document: string
  recovered: boolean
}>

export type StoredCheckpointRow = Readonly<{
  script: string
  audio?: string
}>

export type StoredCompletionOutboxRow = Readonly<{
  jobId?: string
  episodeId: string
  payload: string
}>

export type StoredJobAgUiEventRow = Readonly<{
  readonly sequence: number
  readonly payload: string
}>

export type SqliteJobStatusSnapshot = Readonly<{
  readonly status: string
  readonly count: number
  readonly oldestActiveAt?: string
}>

/**
 * ジョブ集約の永続化契約。document(JSON文字列)を受け渡す形は
 * 正規化後も維持し、上位のアダプタとテストを変更せずに済ませる。
 */
export type SqliteJobHandle = Readonly<{
  findById: (jobId: string) => string | undefined
  findOwned: (ownerId: string, jobId: string) => string | undefined
  listOwned: (ownerId: string, limit: number) => readonly string[]
  statusSnapshot: () => readonly SqliteJobStatusSnapshot[]
  listOwnedAgUiEvents: (input: {
    readonly ownerId: string
    readonly jobId: string
    readonly afterSequence: number
    readonly limit: number
  }) => readonly StoredJobAgUiEventRow[]
  markStep: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly step:
      | "selecting_articles"
      | "materializing_articles"
      | "generating_script"
      | "preparing_pronunciation"
      | "synthesizing_audio"
      | "storing_episode"
    readonly phase: "started" | "finished"
    readonly occurredAt: string
  }) => boolean
  reportStageProgress: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly step: "synthesizing_audio"
    readonly completed: number
    readonly total: number
    readonly occurredAt: string
  }) => boolean
  recordSelectedArticles: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly articles: readonly Readonly<{
      articleId: string
      title: string
      sourceName: string
    }>[]
    readonly occurredAt: string
  }) => boolean
  replaceOwnedActive: (input: {
    readonly ownerId: string
    readonly jobId: string
    readonly replace: (document: string) => string
  }) =>
    | { readonly _tag: "Updated"; readonly document: string }
    | { readonly _tag: "NotFound" }
    | { readonly _tag: "Terminal" }
  requeueRecoverableScheduled: (input: {
    readonly jobId: string
    readonly document: string
  }) => void
  saveIdempotently: (input: {
    readonly ownerId: string
    readonly idempotencyScope: string
    readonly idempotencyKey: string
    readonly requestFingerprint: string
    readonly jobId: string
    readonly document: string
  }) =>
    | { readonly _tag: "Inserted" }
    | { readonly _tag: "Existing"; readonly row: StoredJobRow }
  leaseNext: (input: {
    readonly now: string
    readonly replace: (document: string) => string
  }) => LeasedJobRow | undefined
  hasLease: (jobId: string, leaseToken: string) => boolean
  renewLease: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly now: string
    readonly leasedUntil: string
  }) => boolean
  loadCheckpoint: (jobId: string) => StoredCheckpointRow | undefined
  loadGenerationPlan: (jobId: string) => string | undefined
  listUsedAutomaticArticleIds: (ownerId: string) => readonly string[]
  saveGenerationPlan: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly plan: string
  }) =>
    | { readonly _tag: "Stored"; readonly plan: string }
    | { readonly _tag: "StaleLease" }
  loadDictionarySnapshot: (jobId: string) => string | undefined
  saveDictionarySnapshot: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly snapshot: string
  }) => "Applied" | "StaleLease" | "Conflict"
  saveScriptCheckpoint: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly script: string
  }) => boolean
  saveAudioCheckpoint: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly audio: string
  }) => "Applied" | "StaleLease" | "MissingScript"
  transition: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly document: string
  }) => boolean
  completeWithOutbox: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly document: string
    readonly episodeId: string
    readonly payload: string
    readonly createdAt: string
  }) => "Applied" | "Duplicate" | "StaleLease"
  findCompletionOutbox: (jobId: string) => StoredCompletionOutboxRow | undefined
  listPendingCompletionOutbox: (
    limit: number
  ) => readonly Required<StoredCompletionOutboxRow>[]
  markCompletionPublished: (jobId: string, publishedAt: string) => boolean
  close: () => void
}>
