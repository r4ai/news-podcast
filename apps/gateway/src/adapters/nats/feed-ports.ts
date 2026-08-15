import { parse } from "@news-podcast/kernel"
import {
  type AddFeedSubscriptionReply,
  type ContentFeedSyncJob,
  type DeleteFeedSubscriptionReply,
  type ListFeedSubscriptionsReply,
  type ListFeedSyncJobsReply,
  type SyncFeedSubscriptionReply,
  parseAddFeedSubscriptionReply,
  parseDeleteFeedSubscriptionReply,
  parseListFeedCatalogReply,
  parseListFeedSubscriptionsReply,
  parseListFeedSyncJobsReply,
  parseSyncFeedSubscriptionReply,
  parseUpdateFeedSubscriptionReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  FeedPageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  FeedSyncJobPageSchema,
  FeedSyncJobSchema,
  RegisteredFeedSchema,
  UpdatedFeedSubscriptionSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import {
  badRequest,
  normalizeProblem,
  subscriptionNotFound,
  unauthorized,
  unavailable,
  unprocessable,
} from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * フィード購読とカタログ、および購読ごとの同期ジョブ。
 * 上流の拒否コードを、購読という文脈での問題詳細へ翻訳する。
 */

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>
type FeedSubscription = TypeOf<typeof FeedSubscriptionSchema>
type FeedSubscriptionPage = TypeOf<typeof FeedSubscriptionPageSchema>
type FeedSyncJob = TypeOf<typeof FeedSyncJobSchema>
type FeedSyncJobPage = TypeOf<typeof FeedSyncJobPageSchema>

type AddSubscriptionFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unprocessable>
  | ReturnType<typeof unavailable>
type ListSubscriptionsFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unavailable>
type ListSyncJobsFailure = ListSubscriptionsFailure
type SyncSubscriptionFailure =
  | ReturnType<typeof badRequest>
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof subscriptionNotFound>
  | ReturnType<typeof unavailable>
type DeleteSubscriptionFailure = SyncSubscriptionFailure

const toAddedSubscription = (
  reply: AddFeedSubscriptionReply
): Effect.Effect<FeedSubscription, AddSubscriptionFailure> => {
  if (reply._tag === "Added")
    return parse(FeedSubscriptionSchema)({
      id: reply.subscription.subscriptionId,
      feedId: reply.subscription.feedId,
      enabled: reply.subscription.enabled,
      createdAt: reply.subscription.createdAt,
    }).pipe(Effect.mapError(unavailable))
  if (reply.code === "INVALID_REQUEST") return Effect.fail(unprocessable())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  return Effect.fail(unavailable())
}

const toSubscriptionPage = (
  reply: ListFeedSubscriptionsReply
): Effect.Effect<FeedSubscriptionPage, ListSubscriptionsFailure> => {
  if (reply._tag === "Listed")
    return parse(FeedSubscriptionPageSchema)({
      items: reply.subscriptions.map((subscription) => ({
        id: subscription.subscriptionId,
        feedId: subscription.feedId,
        enabled: subscription.enabled,
        createdAt: subscription.createdAt,
      })),
      page: { hasMore: false },
    }).pipe(Effect.mapError(unavailable))
  return reply.code === "UNAUTHENTICATED"
    ? Effect.fail(unauthorized())
    : Effect.fail(unavailable())
}

const publicSyncJobStatus = {
  Queued: "queued",
  Processing: "processing",
  Succeeded: "succeeded",
  Failed: "failed",
} as const

// 未到達のライフサイクル時刻は、空値ではなくキーごと落として表現する。
const toSyncJobFields = (job: ContentFeedSyncJob) => ({
  jobId: job.jobId,
  feedId: job.feedId,
  feedUrl: job.feedUrl,
  status: publicSyncJobStatus[job.status],
  attempt: job.attempt,
  maxAttempts: job.maxAttempts,
  discovered: job.discovered,
  archived: job.archived,
  failed: job.failed,
  createdAt: job.createdAt,
  ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
  ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
  ...(job.error === undefined ? {} : { error: job.error }),
})

const toSyncJob = (
  job: ContentFeedSyncJob
): Effect.Effect<FeedSyncJob, ListSyncJobsFailure> =>
  parse(FeedSyncJobSchema)(toSyncJobFields(job)).pipe(
    Effect.mapError(unavailable)
  )

const toSyncJobPage = (
  reply: ListFeedSyncJobsReply
): Effect.Effect<FeedSyncJobPage, ListSyncJobsFailure> => {
  if (reply._tag !== "Listed") {
    return reply.code === "UNAUTHENTICATED"
      ? Effect.fail(unauthorized())
      : Effect.fail(unavailable())
  }

  return parse(FeedSyncJobPageSchema)({
    items: reply.jobs.map(toSyncJobFields),
    page: { hasMore: false },
  }).pipe(Effect.mapError(unavailable))
}

const toSyncedJob = (
  reply: SyncFeedSubscriptionReply
): Effect.Effect<FeedSyncJob, SyncSubscriptionFailure> => {
  if (reply._tag === "Synced") return toSyncJob(reply.job)
  if (reply._tag === "NotFound") return Effect.fail(subscriptionNotFound())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  if (reply.code === "INVALID_REQUEST") return Effect.fail(badRequest())
  if (reply.code === "NOT_FOUND") return Effect.fail(subscriptionNotFound())
  return Effect.fail(unavailable())
}

const toDeleted = (
  reply: DeleteFeedSubscriptionReply
): Effect.Effect<void, DeleteSubscriptionFailure> => {
  if (reply._tag === "Deleted") return Effect.void
  if (reply._tag === "NotFound") return Effect.fail(subscriptionNotFound())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  if (reply.code === "INVALID_REQUEST") return Effect.fail(badRequest())
  if (reply.code === "NOT_FOUND") return Effect.fail(subscriptionNotFound())
  return Effect.fail(unavailable())
}

type FeedPorts = Pick<
  GatewayPorts,
  | "addFeedSubscription"
  | "listFeedSubscriptions"
  | "listFeedSyncJobs"
  | "syncFeedSubscription"
  | "deleteFeedSubscription"
  | "updateFeedSubscription"
  | "listFeeds"
  | "registerFeed"
>

export const makeFeedPorts = (transport: Transport): FeedPorts => {
  const contentRpc = <Value>(
    headers: Parameters<GatewayPorts["listFeedSyncJobs"]>[0],
    subject: string,
    payload: unknown,
    decode: (value: unknown) => Effect.Effect<Value, unknown, never>
  ) =>
    transport.ownerRpc(headers, subject, "content-knowledge", payload, decode)

  return {
    addFeedSubscription: ({ headers, payload }) =>
      contentRpc(
        headers,
        subjects.content.addSubscription,
        payload,
        parseAddFeedSubscriptionReply
      ).pipe(Effect.flatMap(toAddedSubscription)),
    listFeedSubscriptions: (headers) =>
      contentRpc(
        headers,
        subjects.content.listSubscriptions,
        {},
        parseListFeedSubscriptionsReply
      ).pipe(Effect.flatMap(toSubscriptionPage)),
    listFeedSyncJobs: (headers) =>
      contentRpc(
        headers,
        subjects.content.listFeedSyncJobs,
        {},
        parseListFeedSyncJobsReply
      ).pipe(Effect.flatMap(toSyncJobPage)),
    syncFeedSubscription: ({ headers, subscriptionId }) =>
      contentRpc(
        headers,
        subjects.content.syncSubscription,
        { subscriptionId },
        parseSyncFeedSubscriptionReply
      ).pipe(Effect.flatMap(toSyncedJob)),
    deleteFeedSubscription: ({ headers, subscriptionId }) =>
      contentRpc(
        headers,
        subjects.content.deleteSubscription,
        { subscriptionId },
        parseDeleteFeedSubscriptionReply
      ).pipe(Effect.flatMap(toDeleted)),
    updateFeedSubscription: ({ headers, subscriptionId, payload }) =>
      contentRpc(
        headers,
        subjects.content.updateSubscription,
        { subscriptionId, enabled: payload.enabled },
        parseUpdateFeedSubscriptionReply
      ).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            TypeOf<typeof UpdatedFeedSubscriptionSchema>,
            | ReturnType<typeof subscriptionNotFound>
            | ReturnType<typeof unavailable>
          > =>
            reply._tag === "Updated"
              ? parse(UpdatedFeedSubscriptionSchema)({
                  id: reply.subscription.subscriptionId,
                  feedId: reply.subscription.feedId,
                  createdAt: reply.subscription.createdAt,
                  enabled: reply.enabled,
                }).pipe(Effect.mapError(unavailable))
              : reply._tag === "NotFound"
                ? Effect.fail(subscriptionNotFound())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    listFeeds: ({ headers, q }) =>
      contentRpc(
        headers,
        subjects.content.listFeedCatalog,
        { ...(q === undefined ? {} : { q }) },
        parseListFeedCatalogReply
      ).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Catalog"
            ? parse(FeedPageSchema)({
                items: reply.feeds.map((feed) => ({
                  id: feed.feedId,
                  name: new URL(feed.feedUrl).hostname,
                  siteUrl: new URL("/", feed.feedUrl).href,
                  feedUrl: feed.feedUrl,
                })),
                page: { hasMore: false },
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    registerFeed: ({ headers, payload }) =>
      contentRpc(
        headers,
        subjects.content.addSubscription,
        payload,
        parseAddFeedSubscriptionReply
      ).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            TypeOf<typeof RegisteredFeedSchema>,
            | ReturnType<typeof unauthorized>
            | ReturnType<typeof unprocessable>
            | ReturnType<typeof unavailable>
          > =>
            reply._tag === "Added"
              ? parse(RegisteredFeedSchema)({
                  feed: {
                    id: reply.subscription.feedId,
                    name: new URL(reply.subscription.feedUrl).hostname,
                    siteUrl: new URL("/", reply.subscription.feedUrl).href,
                    feedUrl: reply.subscription.feedUrl,
                  },
                  subscription: {
                    id: reply.subscription.subscriptionId,
                    feedId: reply.subscription.feedId,
                    enabled: reply.subscription.enabled,
                    createdAt: reply.subscription.createdAt,
                  },
                }).pipe(Effect.mapError(unavailable))
              : reply.code === "UNAUTHENTICATED"
                ? Effect.fail(unauthorized())
                : reply.code === "INVALID_REQUEST"
                  ? Effect.fail(unprocessable())
                  : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
