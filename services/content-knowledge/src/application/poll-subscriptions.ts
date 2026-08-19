import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { FeedFetchError, RssFeedReader } from "./ports/article-catalog.js"
import {
  ArchiveCommandSchema,
  type Sha256,
  type ArchiveRequestId,
  type ArticleId,
} from "../domain/article.js"
import type { FeedId, FeedUrl } from "../domain/subscription.js"
import type {
  ArchiveArticleInvocation,
  ArchiveArticleResult,
} from "./archive-article.js"
import type {
  ArchiveMessageContext,
  ArchiveStoreError,
  CaptureError,
} from "./ports/archive.js"
import type {
  SubscriptionRepository,
  SubscriptionStoreError,
} from "./ports/subscription.js"
import type {
  ArticleCatalog,
  ArticleCatalogError,
} from "./ports/article-catalog.js"

export type FeedPollFailure = DeepReadonly<{
  readonly _tag: "FeedPollFailed"
  readonly scope: "Feed" | "Item"
  readonly reason:
    | FeedFetchError["reason"]
    | "ArchiveFailed"
    | "InvalidItem"
    | "CatalogFailed"
}>

export type FeedPollResult = DeepReadonly<{
  readonly feeds: number
  readonly discovered: number
  readonly archived: number
  readonly alreadyArchived: number
  readonly failed: number
  readonly failures: readonly FeedPollFailure[]
}>

export type PollSubscriptionsPorts = Readonly<{
  readonly subscriptions: Pick<SubscriptionRepository, "listFeedsForPolling">
  readonly catalog?: Pick<ArticleCatalog, "upsert"> &
    Partial<Pick<ArticleCatalog, "markCaptured">>
  readonly reader: RssFeedReader
  readonly archive: (
    invocation: ArchiveArticleInvocation
  ) => Effect.Effect<ArchiveArticleResult, ArchiveStoreError | CaptureError>
  readonly deriveArticleIdentity: (input: {
    readonly feedId: FeedId
    readonly externalId: string
    readonly captureFingerprint: Sha256
  }) => DeepReadonly<{
    readonly archiveRequestId: ArchiveRequestId
    readonly articleId: ArticleId
  }>
  readonly newContext: () => ArchiveMessageContext
  readonly now: () => string
}>

const empty = (): FeedPollResult =>
  deepFreeze({
    feeds: 0,
    discovered: 0,
    archived: 0,
    alreadyArchived: 0,
    failed: 0,
    failures: [],
  })

const combine = (left: FeedPollResult, right: FeedPollResult): FeedPollResult =>
  deepFreeze({
    feeds: left.feeds + right.feeds,
    discovered: left.discovered + right.discovered,
    archived: left.archived + right.archived,
    alreadyArchived: left.alreadyArchived + right.alreadyArchived,
    failed: left.failed + right.failed,
    failures: [...left.failures, ...right.failures],
  })

const oneFailure = (
  reason: FeedPollFailure["reason"],
  scope: FeedPollFailure["scope"],
  discovered = 0
): FeedPollResult =>
  deepFreeze({
    feeds: 0,
    discovered,
    archived: 0,
    alreadyArchived: 0,
    failed: 1,
    failures: [deepFreeze({ _tag: "FeedPollFailed" as const, scope, reason })],
  })

const parseArchiveCommand = parse(ArchiveCommandSchema)

const classifyItemProcessingFailure = (
  failure: unknown
): Pick<FeedPollFailure, "reason" | "scope"> => {
  const tag =
    typeof failure === "object" && failure !== null && "_tag" in failure
      ? failure._tag
      : undefined
  if (tag === "ArticleCatalogFailed")
    return { reason: "CatalogFailed", scope: "Feed" }
  if (tag === "ArchiveStoreFailed" || tag === "CaptureFailed")
    return { reason: "ArchiveFailed", scope: "Item" }
  return { reason: "InvalidItem", scope: "Item" }
}

/** Polls one feed; item-level failures are reported without aborting the feed. */
export const pollFeed =
  (ports: PollSubscriptionsPorts) =>
  (feed: { readonly feedId: FeedId; readonly feedUrl: FeedUrl }) =>
    ports.reader.read(feed.feedUrl).pipe(
      Effect.flatMap((items) =>
        Effect.forEach(
          items,
          (item) => {
            const identity = ports.deriveArticleIdentity({
              feedId: feed.feedId,
              externalId: item.externalId,
              captureFingerprint: item.captureFingerprint,
            })
            return parseArchiveCommand({
              ...identity,
              sourceUrl: item.url,
              title: item.title,
            }).pipe(
              Effect.flatMap((command) =>
                (ports.catalog === undefined
                  ? Effect.succeed({ _tag: "CaptureRequired" as const })
                  : ports.catalog.upsert({
                      articleId: command.articleId,
                      feedId: feed.feedId,
                      externalId: item.externalId,
                      sourceUrl: command.sourceUrl,
                      title: command.title,
                      ...(item.publishedAt === undefined
                        ? {}
                        : { publishedAt: item.publishedAt }),
                      discoveredAt: ports.now(),
                      captureFingerprint: item.captureFingerprint,
                    })
                ).pipe(
                  Effect.flatMap(
                    (
                      decision
                    ): Effect.Effect<
                      Readonly<{ _tag: "Archived" | "AlreadyArchived" }>,
                      ArchiveStoreError | CaptureError
                    > =>
                      decision._tag === "Unchanged"
                        ? Effect.succeed({ _tag: "AlreadyArchived" as const })
                        : ports
                            .archive(
                              deepFreeze({
                                command,
                                context: ports.newContext(),
                              })
                            )
                            .pipe(
                              Effect.map((result) => ({ _tag: result._tag }))
                            )
                  ),
                  Effect.tap(() =>
                    ports.catalog?.markCaptured === undefined
                      ? Effect.void
                      : ports.catalog.markCaptured({
                          articleId: command.articleId,
                          captureFingerprint: item.captureFingerprint,
                        })
                  )
                )
              ),
              Effect.match({
                onFailure: (failure): FeedPollResult => {
                  const classified = classifyItemProcessingFailure(failure)
                  return oneFailure(classified.reason, classified.scope, 1)
                },
                onSuccess: (result): FeedPollResult =>
                  deepFreeze({
                    ...empty(),
                    discovered: 1,
                    archived: result._tag === "Archived" ? 1 : 0,
                    alreadyArchived: result._tag === "AlreadyArchived" ? 1 : 0,
                  }),
              })
            )
          },
          { concurrency: 1 }
        ).pipe(Effect.map((results) => results.reduce(combine, empty())))
      ),
      Effect.match({
        onFailure: (failure): FeedPollResult =>
          deepFreeze({
            ...oneFailure(failure.reason, "Feed"),
            feeds: 1,
          }),
        onSuccess: (result): FeedPollResult =>
          deepFreeze({ ...result, feeds: 1 }),
      })
    )

/** Polls feeds sequentially so a slow origin cannot amplify outbound load. */
export const pollSubscriptions =
  (ports: PollSubscriptionsPorts) =>
  (): Effect.Effect<
    FeedPollResult,
    SubscriptionStoreError | ArticleCatalogError
  > =>
    ports.subscriptions.listFeedsForPolling().pipe(
      Effect.flatMap((feeds) =>
        Effect.forEach(feeds, pollFeed(ports), { concurrency: 1 })
      ),
      Effect.map((results) => results.reduce(combine, empty()))
    )
