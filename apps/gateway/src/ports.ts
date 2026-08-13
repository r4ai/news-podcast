import type { Effect, Schema } from "effect"

import {
  AddFeedSubscriptionRequestSchema,
  ArticleArchiveResultSchema,
  ArticleFacetsSchema,
  ArticleIdSchema,
  ArticleMarkdownSchema,
  ArticlePageSchema,
  ArticleSchema,
  ArticleStatePatchSchema,
  ArticleTagsSchema,
  SetArticleTagsSchema,
  AudioAccessSchema,
  BadRequestProblemSchema,
  BulkArticleStateResultSchema,
  BulkArticleStateSchema,
  ConflictProblemSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  EpisodeSchema,
  EpisodeJobSchema,
  EpisodeJobPageSchema,
  EpisodePageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  FeedSyncJobPageSchema,
  FeedPageSchema,
  RegisteredFeedSchema,
  UpdatedFeedSubscriptionSchema,
  UpdateFeedSubscriptionSchema,
  UserSettingsSchema,
  UpdateSettingsSchema,
  TagSchema,
  TagPageSchema,
  TagSuggestionPageSchema,
  CreateTagSchema,
  ReadingDictionaryEntrySchema,
  ReadingDictionaryPageSchema,
  CreateReadingDictionarySchema,
  UpdateReadingDictionarySchema,
  EnrichQueueSchema,
  EnrichmentEnqueuedSchema,
  HealthResponseSchema,
  JobReceiptSchema,
  JobIdSchema,
  NotFoundProblemSchema,
  SessionHeadersSchema,
  SessionResponseSchema,
  SubscriptionIdSchema,
  UnauthorizedProblemSchema,
  UnavailableProblemSchema,
  UnprocessableProblemSchema,
  AgentInstancePageSchema,
  AgentRunSchema,
  AgentMemorySchema,
  AgentMemoryPageSchema,
  CreateAgentMemorySchema,
  AgentRunEventSchema,
} from "./contract.js"

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>

export type GatewayPorts = Readonly<{
  health: () => Effect.Effect<TypeOf<typeof HealthResponseSchema>>
  resolveSession: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof SessionResponseSchema>,
    TypeOf<typeof UnavailableProblemSchema>
  >
  createEpisodeJob: (input: {
    readonly headers: TypeOf<typeof CreateEpisodeJobHeadersSchema>
    readonly payload: TypeOf<typeof CreateEpisodeJobRequestSchema>
  }) => Effect.Effect<
    TypeOf<typeof JobReceiptSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnprocessableProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listEpisodeJobs: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly limit?: number
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  cancelEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  retryEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
    readonly idempotencyKey: string
  }) => Effect.Effect<
    TypeOf<typeof JobReceiptSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  replayEpisodeJobEvents: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
    readonly afterSequence: number
  }) => Effect.Effect<
    Readonly<{
      snapshot: TypeOf<typeof EpisodeJobSchema>
      events: readonly Readonly<{
        sequence: number
        job: TypeOf<typeof EpisodeJobSchema>
      }>[]
    }>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listEpisodes: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly cursor?: string
  }) => Effect.Effect<
    TypeOf<typeof EpisodePageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getEpisode: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly episodeId: TypeOf<typeof EpisodeIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  createAudioAccess: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly episodeId: TypeOf<typeof EpisodeIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof AudioAccessSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  addFeedSubscription: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof AddFeedSubscriptionRequestSchema>
  }) => Effect.Effect<
    TypeOf<typeof FeedSubscriptionSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnprocessableProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listFeedSubscriptions: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof FeedSubscriptionPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listFeedSyncJobs: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof FeedSyncJobPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  deleteFeedSubscription: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly subscriptionId: TypeOf<typeof SubscriptionIdSchema>
  }) => Effect.Effect<
    void,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  updateFeedSubscription: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly subscriptionId: TypeOf<typeof SubscriptionIdSchema>
    readonly payload: TypeOf<typeof UpdateFeedSubscriptionSchema>
  }) => Effect.Effect<
    TypeOf<typeof UpdatedFeedSubscriptionSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listFeeds: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly q?: string
  }) => Effect.Effect<
    TypeOf<typeof FeedPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  registerFeed: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof AddFeedSubscriptionRequestSchema>
  }) => Effect.Effect<
    TypeOf<typeof RegisteredFeedSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnprocessableProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listArticles: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly query: Readonly<{
      readonly limit?: number
      readonly state?: "all" | "unread" | "saved" | "later"
      readonly includeHidden?: boolean
      readonly feedIds?: readonly string[]
      readonly q?: string
      readonly sort?: "newest" | "oldest"
    }>
  }) => Effect.Effect<
    TypeOf<typeof ArticlePageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getArticle: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getArticleMarkdown: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleMarkdownSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  patchArticle: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
    readonly payload: TypeOf<typeof ArticleStatePatchSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  bulkPatchArticles: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof BulkArticleStateSchema>
  }) => Effect.Effect<
    TypeOf<typeof BulkArticleStateResultSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getArticleFacets: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly query: Readonly<{
      readonly includeHidden?: boolean
      readonly feedIds?: readonly string[]
      readonly q?: string
    }>
  }) => Effect.Effect<
    TypeOf<typeof ArticleFacetsSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  archiveArticle: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleArchiveResultSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listArticleTags: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleTagsSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  setArticleTags: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
    readonly payload: TypeOf<typeof SetArticleTagsSchema>
  }) => Effect.Effect<
    TypeOf<typeof ArticleTagsSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  enrichArticle: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly articleId: TypeOf<typeof ArticleIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EnrichmentEnqueuedSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getSettings: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof UserSettingsSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  updateSettings: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof UpdateSettingsSchema>
  }) => Effect.Effect<
    TypeOf<typeof UserSettingsSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listTags: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof TagPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  createTag: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof CreateTagSchema>
  }) => Effect.Effect<
    TypeOf<typeof TagSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  deleteTag: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly tagId: string
  }) => Effect.Effect<
    void,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listTagSuggestions: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof TagSuggestionPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  promoteTagSuggestion: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof CreateTagSchema>
  }) => Effect.Effect<
    TypeOf<typeof TagSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listReadingDictionary: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof ReadingDictionaryPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  createReadingDictionary: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof CreateReadingDictionarySchema>
  }) => Effect.Effect<
    TypeOf<typeof ReadingDictionaryEntrySchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  updateReadingDictionary: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly id: string
    readonly payload: TypeOf<typeof UpdateReadingDictionarySchema>
  }) => Effect.Effect<
    TypeOf<typeof ReadingDictionaryEntrySchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  deleteReadingDictionary: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly id: string
  }) => Effect.Effect<
    void,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getEnrichQueue: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof EnrichQueueSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  enrichReprocess: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    { readonly enqueued: number },
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  enrichResetDaily: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    { readonly message: "Daily enrichment usage reset" },
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listAgentInstances: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof AgentInstancePageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getAgentRun: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    runId: string
  }) => Effect.Effect<
    TypeOf<typeof AgentRunSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  replayAgentRunEvents: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    runId: string
    afterSequence: number
  }) => Effect.Effect<
    readonly TypeOf<typeof AgentRunEventSchema>[],
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listAgentMemories: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    agentInstanceId: string
  }) => Effect.Effect<
    TypeOf<typeof AgentMemoryPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  createAgentMemory: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    agentInstanceId: string
    payload: TypeOf<typeof CreateAgentMemorySchema>
  }) => Effect.Effect<
    TypeOf<typeof AgentMemorySchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  approveAgentMemory: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    agentInstanceId: string
    memoryId: string
  }) => Effect.Effect<
    TypeOf<typeof AgentMemorySchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  deleteAgentMemory: (input: {
    headers: TypeOf<typeof SessionHeadersSchema>
    agentInstanceId: string
    memoryId: string
  }) => Effect.Effect<
    void,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
}>
