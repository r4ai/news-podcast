import { createHash, randomUUID } from "node:crypto"

import type {
  Actor,
  CorrelationId,
  MessageId,
  ServiceName,
  Traceparent,
} from "@news-podcast/protocols"

import type {
  ArchiveRequestId,
  ArticleId,
  CapturedAt,
  SnapshotId,
} from "../../domain/article.js"
import type { FeedId, SubscriptionId } from "../../domain/subscription.js"

/** Platform guarantees UUID v4 and ISO UTC output; casts remain confined to unsafe. */
export const randomMessageIdUnsafe = (): MessageId => randomUUID() as MessageId
export const randomCorrelationIdUnsafe = (): CorrelationId =>
  randomUUID() as CorrelationId
export const randomSnapshotIdUnsafe = (): SnapshotId =>
  randomUUID() as SnapshotId
export const randomTraceparentUnsafe = (): Traceparent => {
  const traceId = createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 32)
  const spanId = createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 16)
  return `00-${traceId}-${spanId}-01` as Traceparent
}

export const currentCapturedAtUnsafe = (): CapturedAt =>
  new Date().toISOString() as CapturedAt

/** Compile-time constant satisfying the protocol service-name grammar. */
export const contentKnowledgeActorUnsafe: Actor = Object.freeze({
  _tag: "Service",
  service: "content-knowledge" as ServiceName,
})

export const randomSubscriptionIdentityUnsafe = () => ({
  subscriptionId: randomUUID() as SubscriptionId,
  feedId: randomUUID() as FeedId,
})

const deterministicUuidV4 = (namespace: string, input: string): string => {
  const bytes = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(input)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Stable item identity makes every polling retry converge on one snapshot/outbox intent. */
export const deriveArticleIdentityUnsafe = (input: {
  readonly feedId: FeedId
  readonly externalId: string
}) => {
  const key = `${input.feedId}\0${input.externalId}`
  return {
    articleId: deterministicUuidV4("content-article", key) as ArticleId,
    archiveRequestId: deterministicUuidV4(
      "content-archive-request",
      key
    ) as ArchiveRequestId,
  }
}

/** Stable across retries while intentionally distinct from feed-poll capture intents. */
export const deriveManualArchiveRequestIdUnsafe = (
  articleId: ArticleId
): ArchiveRequestId =>
  deterministicUuidV4(
    "content-manual-archive-request",
    articleId
  ) as ArchiveRequestId
