import { z } from "@hono/zod-openapi"

export const IdSchema = z.uuid().openapi("Id")
export const JobStatusSchema = z
  .enum(["queued", "running", "retrying", "succeeded", "failed", "canceled"])
  .openapi("JobStatus")
export const JobStageSchema = z
  .enum([
    "researching_sources",
    "fetching_sources",
    "generating_script",
    "synthesizing_audio",
    "storing_episode",
  ])
  .openapi("JobStage")

/**
 * 1エピソードで扱える選択記事の上限。台本の上限6000文字に対して、
 * 1記事あたり最低でも数百文字は割かないと紹介にならないため。
 */
export const MAX_SELECTED_ARTICLES = 20

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    code: z.string(),
    detail: z.string().optional(),
  })
  .openapi("Problem")

export const FeedSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    siteUrl: z.url(),
    feedUrl: z.url(),
  })
  .openapi("Feed")

// 記事一覧/facets/一括操作のarchiveStatus絞り込みと、Article.archiveStatusで共有する。
export const ArticleArchiveStatusSchema = z.enum([
  "pending",
  "archiving",
  "succeeded",
  "failed",
])

export const SubscriptionSchema = z
  .object({
    id: IdSchema,
    feedId: IdSchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .openapi("FeedSubscription")

export const ArticleSchema = z
  .object({
    id: IdSchema,
    feedId: IdSchema,
    sourceName: z.string(),
    title: z.string(),
    url: z.url(),
    publishedAt: z.iso.datetime().optional(),
    summary: z.string().optional(),
    discoveredAt: z.iso.datetime(),
    archiveStatus: ArticleArchiveStatusSchema,
    snapshotId: IdSchema.optional(),
    read: z.boolean(),
    saved: z.boolean(),
    readLater: z.boolean(),
    hidden: z.boolean(),
    hiddenAt: z.iso.datetime().optional(),
    usedInEpisode: z.boolean(),
    archiveUrl: z.string().optional(),
    markdownUrl: z.string().optional(),
    aiSummary: z.array(z.string()).length(3).optional(),
    relevanceScore: z.number().int().min(0).max(100).optional(),
    relevanceReason: z.string().optional(),
    // 手動+AI付与タグ名の和集合。未付与なら空配列。
    tags: z.array(z.string()),
  })
  .openapi("Article")

export const TagNameSchema = z.string().min(1).max(50)

export const TagSchema = z
  .object({
    id: IdSchema,
    name: TagNameSchema,
    createdAt: z.iso.datetime(),
  })
  .openapi("Tag")

export const TagSuggestionSchema = z
  .object({
    name: TagNameSchema,
    occurrences: z.number().int().min(1),
    lastSeenAt: z.iso.datetime(),
  })
  .openapi("TagSuggestion")

export const ArticleFacetsSchema = z
  .object({
    states: z.object({
      all: z.number().int().nonnegative(),
      unread: z.number().int().nonnegative(),
      saved: z.number().int().nonnegative(),
      later: z.number().int().nonnegative(),
    }),
    feeds: z.array(
      z.object({
        feedId: IdSchema,
        name: z.string(),
        count: z.number().int().nonnegative(),
      })
    ),
    // 絞り込み条件に依存しない、購読全体のAI補助バッチ未処理件数。
    aiPending: z.number().int().nonnegative(),
  })
  .openapi("ArticleFacets")

export const BulkArticleStateResultSchema = z
  .object({
    updated: z.number().int().nonnegative(),
  })
  .openapi("BulkArticleStateResult")

export const ScheduleSchema = z
  .object({
    enabled: z.boolean(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().min(1),
  })
  .openapi("GenerationSchedule")

export const InterestProfileSchema = z
  .object({
    // 含めたい話題（自由記述）。
    include: z.string().max(2_000),
    // 除きたい話題（自由記述）。
    exclude: z.string().max(2_000),
  })
  .openapi("InterestProfile")

export const SettingsSchema = z
  .object({
    generationSchedule: ScheduleSchema,
    interestProfile: InterestProfileSchema,
  })
  .openapi("UserSettings")

const FailureSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  })
  .openapi("JobFailure")

export const JobSchema = z
  .object({
    id: IdSchema,
    status: JobStatusSchema,
    createdAt: z.iso.datetime(),
    articleIds: z.array(IdSchema).optional(),
    attempt: z.number().int().min(0).max(4),
    maxAttempts: z.literal(4),
    stage: JobStageSchema.optional(),
    stageStartedAt: z.iso.datetime().optional(),
    lastProgressAt: z.iso.datetime().optional(),
    deadlineAt: z.iso.datetime().optional(),
    stageProgress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().min(1),
      })
      .optional(),
    startedAt: z.iso.datetime().optional(),
    finishedAt: z.iso.datetime().optional(),
    nextAttemptAt: z.iso.datetime().optional(),
    episodeId: IdSchema.optional(),
    failure: FailureSchema.optional(),
  })
  .openapi("EpisodeJob")

export const JobReceiptSchema = JobSchema.pick({
  id: true,
  status: true,
  createdAt: true,
  attempt: true,
  maxAttempts: true,
}).openapi("EpisodeJobReceipt")

export const AgentRunSchema = z
  .object({
    id: IdSchema,
    jobId: IdSchema,
    status: z.enum([
      "queued",
      "running",
      "waiting_approval",
      "retrying",
      "succeeded",
      "failed",
      "canceled",
    ]),
    policyHash: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("AgentRun")

export const AgentEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: IdSchema,
    sequence: z.number().int().nonnegative(),
    type: z.string(),
    occurredAt: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()),
  })
  .openapi("AgentEvent")

export const AgentInstanceSchema = z
  .object({
    id: IdSchema,
    agentKey: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("AgentInstance")

export const AgentMemorySchema = z
  .object({
    id: IdSchema,
    agentInstanceId: IdSchema,
    kind: z.enum(["preference", "episode_history", "working_note"]),
    status: z.enum(["proposed", "active", "rejected", "deleted"]),
    version: z.number().int().min(1),
    content: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
  })
  .openapi("AgentMemory")

const EpisodeSourceSchema = z
  .object({
    url: z.url(),
    title: z.string(),
    publishedAt: z.iso.datetime().optional(),
    snapshotId: IdSchema.optional(),
    sourceKind: z.enum(["rss", "web"]).optional(),
  })
  .openapi("EpisodeSource")

export const EpisodeSchema = z
  .object({
    id: IdSchema,
    title: z.string(),
    script: z.string(),
    sources: z.array(EpisodeSourceSchema).min(1),
    createdAt: z.iso.datetime(),
  })
  .openapi("Episode")

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.object({
      hasMore: z.boolean(),
      nextCursor: z.string().optional(),
    }),
  })

export const jsonContent = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
})

export const problemContent = (description: string) => ({
  content: { "application/problem+json": { schema: ProblemSchema } },
  description,
})
