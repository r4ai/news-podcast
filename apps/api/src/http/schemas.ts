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
    archiveStatus: z.enum(["pending", "archiving", "succeeded", "failed"]),
    snapshotId: IdSchema.optional(),
    read: z.boolean(),
    saved: z.boolean(),
    archiveUrl: z.string().optional(),
    markdownUrl: z.string().optional(),
  })
  .openapi("Article")

export const ScheduleSchema = z
  .object({
    enabled: z.boolean(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().min(1),
  })
  .openapi("GenerationSchedule")

export const SettingsSchema = z
  .object({ generationSchedule: ScheduleSchema })
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
    attempt: z.number().int().nonnegative(),
    stage: JobStageSchema.optional(),
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
    page: z.object({ hasMore: z.literal(false) }),
  })

export const jsonContent = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
})

export const problemContent = (description: string) => ({
  content: { "application/problem+json": { schema: ProblemSchema } },
  description,
})
