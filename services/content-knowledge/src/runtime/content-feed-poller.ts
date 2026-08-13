import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import { createHttpRssFeedReader } from "../adapters/http-rss-feed-reader.js"
import { archiveArticle } from "../application/archive-article.js"
import { pollFeed } from "../application/poll-subscriptions.js"
import { runFeedSyncCycle } from "../application/feed-sync-worker.js"
import {
  contentKnowledgeActorUnsafe,
  currentCapturedAtUnsafe,
  deriveArticleIdentityUnsafe,
  randomCorrelationIdUnsafe,
  randomMessageIdUnsafe,
  randomSnapshotIdUnsafe,
  randomTraceparentUnsafe,
} from "../infrastructure/unsafe/identity.js"
import type { HttpS3ArticleCaptureResource } from "../infrastructure/unsafe/http-s3-article-capture.js"
import {
  runFeedPollLoop,
  type FeedPollLoopConfig,
  type FeedPollWakeup,
} from "./feed-poll-loop.js"
import type { NodeContentKnowledgeRuntime } from "./node.js"

export type ContentFeedPollerConfig = Readonly<{
  readonly http: Readonly<{
    readonly timeoutMillis: number
    readonly maximumBytes: number
  }>
  readonly loop: FeedPollLoopConfig
}>

export type ContentFeedPollerDependencies = Readonly<{
  readonly newSnapshotId: typeof randomSnapshotIdUnsafe
  readonly newMessageId: typeof randomMessageIdUnsafe
  readonly newCorrelationId: typeof randomCorrelationIdUnsafe
  readonly newTraceparent: typeof randomTraceparentUnsafe
  readonly now: typeof currentCapturedAtUnsafe
  readonly deriveArticleIdentity: typeof deriveArticleIdentityUnsafe
}>

const defaultDependencies: ContentFeedPollerDependencies = Object.freeze({
  newSnapshotId: randomSnapshotIdUnsafe,
  newMessageId: randomMessageIdUnsafe,
  newCorrelationId: randomCorrelationIdUnsafe,
  newTraceparent: randomTraceparentUnsafe,
  now: currentCapturedAtUnsafe,
  deriveArticleIdentity: deriveArticleIdentityUnsafe,
})

export const makeContentFeedPollOnce = (
  config: Pick<ContentFeedPollerConfig, "http">,
  runtime: Pick<
    NodeContentKnowledgeRuntime,
    "articles" | "store" | "subscriptions" | "feedSyncQueue"
  >,
  captureResource: Pick<HttpS3ArticleCaptureResource, "capture" | "fetcher">,
  dependencies: ContentFeedPollerDependencies = defaultDependencies
) => {
  const archive = archiveArticle({
    ...runtime.store,
    capture: captureResource.capture,
    newSnapshotId: dependencies.newSnapshotId,
    now: dependencies.now,
  })
  const ports = {
    subscriptions: runtime.subscriptions,
    catalog: runtime.articles,
    reader: createHttpRssFeedReader(config.http, captureResource.fetcher),
    archive,
    deriveArticleIdentity: dependencies.deriveArticleIdentity,
    now: dependencies.now,
    newContext: () =>
      deepFreeze({
        messageId: dependencies.newMessageId(),
        correlationId: dependencies.newCorrelationId(),
        traceparent: dependencies.newTraceparent(),
        actor: contentKnowledgeActorUnsafe,
      }),
  } as const
  return runFeedSyncCycle({
    subscriptions: runtime.subscriptions,
    queue: runtime.feedSyncQueue,
    pollFeed: pollFeed(ports),
    now: dependencies.now,
  })
}

/** Production scheduler composition: RSS and article fetches share one SSRF boundary. */
export const runContentFeedPoller = (
  config: ContentFeedPollerConfig,
  runtime: Pick<
    NodeContentKnowledgeRuntime,
    "articles" | "store" | "subscriptions" | "feedSyncQueue"
  >,
  captureResource: Pick<HttpS3ArticleCaptureResource, "capture" | "fetcher">,
  dependencies: ContentFeedPollerDependencies = defaultDependencies,
  wakeup?: FeedPollWakeup
): Effect.Effect<void> =>
  runFeedPollLoop(
    config.loop,
    makeContentFeedPollOnce(config, runtime, captureResource, dependencies),
    wakeup === undefined
      ? undefined
      : {
          waitForNextCycle: (delayMillis) =>
            Effect.race(Effect.sleep(delayMillis), wakeup.wait()),
        }
  )
