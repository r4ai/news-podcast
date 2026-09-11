import type {
  ArchiveRefreshQueue,
  ArchiveRefreshJob,
  ArchiveRefreshFailure,
} from "../../application/archive-refresh.js"
import {
  runArchiveRefreshWorker,
  type ArchiveRefreshObservation,
} from "../loops/archive-refresh.js"
import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  ArticleListQuerySchema,
  parseArticleStatePatch,
  createOwnerReplayAccess,
  readOwnerArticleMarkdown,
  readOwnerSnapshotMarkdown,
  triggerOwnerArticleArchive,
  type ArticleLibraryRepository,
} from "../../application/article-library.js"
import type { MarkdownObjectReader } from "../../application/ports/article-catalog.js"
import {
  ArticleIdSchema,
  SnapshotIdSchema,
  type ArchiveRequestId,
  type CapturedAt,
} from "../../domain/article.js"
import { ArticleStatePatchSchema } from "../../domain/article-library.js"
import { FeedIdSchema, OwnerIdSchema } from "../../domain/subscription.js"
import type {
  ArchiveArticleInvocation,
  ArchiveArticleResult,
} from "../../application/archive-article.js"
import type {
  ArchiveMessageContext,
  ArchiveStoreError,
  CaptureError,
} from "../../application/ports/archive.js"

type RefreshReply =
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "ArchiveAccepted"; readonly job: ArchiveRefreshJob }

const ArticleIdentitySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  articleId: ArticleIdSchema,
})
const SnapshotIdentitySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  articleId: ArticleIdSchema,
  snapshotId: SnapshotIdSchema,
})
const ListInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: ArticleListQuerySchema,
})
const PatchInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  articleId: ArticleIdSchema,
  patch: ArticleStatePatchSchema,
})
const ArticleFilterFields = {
  includeHidden: Schema.Boolean,
  feedIds: Schema.Array(FeedIdSchema).check(
    Schema.isMaxLength(50),
    Schema.makeFilter((feedIds) =>
      new Set(feedIds).size === feedIds.length
        ? true
        : "feed IDs must be unique"
    )
  ),
  q: Schema.optional(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    )
  ),
} as const
const BulkInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: Schema.Struct({
    state: Schema.Literals(["All", "Unread", "Saved", "Later"]),
    ...ArticleFilterFields,
  }),
  patch: ArticleStatePatchSchema,
})
const FacetsInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: Schema.Struct(ArticleFilterFields),
})

export type ArticleLibraryRequestError = DeepReadonly<{
  readonly _tag: "ArticleLibraryRequestRejected"
  readonly code: "InvalidRequest"
}>

const invalidRequest = (): ArticleLibraryRequestError =>
  deepFreeze({
    _tag: "ArticleLibraryRequestRejected",
    code: "InvalidRequest",
  })

const strict =
  <S extends Schema.Top>(schema: S) =>
  (input: unknown) =>
    parse(schema)(input).pipe(Effect.mapError(invalidRequest))

export type ArticleLibraryHandlerDependencies = Readonly<{
  readonly archiveQueue?: ArchiveRefreshQueue
  readonly observeArchiveRefresh?: (value: ArchiveRefreshObservation) => void
  readonly articles: ArticleLibraryRepository
  readonly objects: MarkdownObjectReader
  readonly replaySigner?: import("../../application/article-library.js").ReplayAccessSigner
  readonly now: () => CapturedAt
  readonly nowEpochMillis?: () => number
  readonly deriveArchiveRequestId: (input: {
    readonly articleId: Schema.Schema.Type<typeof ArticleIdSchema>
    readonly messageId: ArchiveMessageContext["messageId"]
  }) => ArchiveRequestId
  readonly archive: (
    invocation: ArchiveArticleInvocation
  ) => Effect.Effect<ArchiveArticleResult, ArchiveStoreError | CaptureError>
}>

/** Transport-neutral handlers; authentication must supply the owner, parsing still fails closed. */
export const makeArticleLibraryHandler = (
  dependencies: ArticleLibraryHandlerDependencies
) => {
  const markdown = readOwnerArticleMarkdown({
    articles: dependencies.articles,
    objects: dependencies.objects,
  })
  const snapshotMarkdown = readOwnerSnapshotMarkdown({
    articles: dependencies.articles,
    objects: dependencies.objects,
  })
  const triggerArchive = triggerOwnerArticleArchive({
    articles: dependencies.articles,
    deriveArchiveRequestId: dependencies.deriveArchiveRequestId,
    archive: dependencies.archive,
  })
  const replayAccess = createOwnerReplayAccess({
    articles: dependencies.articles,
    signer:
      dependencies.replaySigner ??
      deepFreeze({
        issue: () =>
          Effect.fail(
            deepFreeze({ _tag: "ReplayAccessSigningFailure" as const })
          ),
      }),
    nowEpochMillis: dependencies.nowEpochMillis ?? Date.now,
  })

  const observe = dependencies.observeArchiveRefresh ?? (() => undefined)
  const unavailableQueue = () =>
    Effect.fail({
      _tag: "ArchiveRefreshFailed" as const,
      reason: "storage" as const,
    })
  return deepFreeze({
    runArchiveWorker: () =>
      dependencies.archiveQueue === undefined
        ? Effect.never
        : runArchiveRefreshWorker(
            dependencies.archiveQueue,
            (input) =>
              triggerArchive(input).pipe(
                Effect.flatMap((result) =>
                  result._tag === "NotFound"
                    ? Effect.fail({ _tag: "ArchiveArticleNotFound" })
                    : Effect.succeed(result)
                )
              ),
            observe
          ),
    enqueueArchive: (input: unknown, context: ArchiveMessageContext) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) =>
          dependencies.articles.find(ownerId, articleId).pipe(
            Effect.flatMap(
              (found): Effect.Effect<RefreshReply, ArchiveRefreshFailure> =>
                found._tag === "NotFound"
                  ? Effect.succeed({ _tag: "NotFound" as const })
                  : (
                      dependencies.archiveQueue?.enqueue(
                        { ownerId, articleId, context },
                        dependencies.now()
                      ) ?? unavailableQueue()
                    ).pipe(
                      Effect.tap((result) =>
                        Effect.sync(() =>
                          observe({
                            event: result.reused ? "reused" : "admitted",
                          })
                        )
                      ),
                      Effect.tapError((error) =>
                        Effect.sync(() =>
                          observe({ event: "rejected", reason: error.reason })
                        )
                      ),
                      Effect.map(({ job }) => ({
                        _tag: "ArchiveAccepted" as const,
                        job,
                      }))
                    )
            )
          )
        )
      ),
    archiveStatus: (input: unknown) =>
      strict(
        Schema.Struct({
          ownerId: OwnerIdSchema,
          articleId: ArticleIdSchema,
          jobId: Schema.String.check(Schema.isUUID(4)),
        })
      )(input).pipe(
        Effect.flatMap(({ ownerId, articleId, jobId }) =>
          dependencies.articles
            .find(ownerId, articleId)
            .pipe(
              Effect.flatMap(
                (found): Effect.Effect<RefreshReply, ArchiveRefreshFailure> =>
                  found._tag === "NotFound"
                    ? Effect.succeed({ _tag: "NotFound" as const })
                    : (
                        dependencies.archiveQueue?.find(
                          ownerId,
                          articleId,
                          jobId,
                          dependencies.now()
                        ) ?? unavailableQueue()
                      ).pipe(
                        Effect.map((job) =>
                          job === undefined
                            ? { _tag: "NotFound" as const }
                            : { _tag: "ArchiveAccepted" as const, job }
                        )
                      )
              )
            )
        )
      ),
    list: (input: unknown) =>
      strict(ListInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query }) =>
          dependencies.articles.list(ownerId, query)
        )
      ),
    find: (input: unknown) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) =>
          dependencies.articles.find(ownerId, articleId)
        )
      ),
    findSnapshot: (input: unknown) =>
      strict(SnapshotIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId, snapshotId }) =>
          dependencies.articles.findSnapshot(ownerId, articleId, snapshotId)
        )
      ),
    markdown: (input: unknown) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) => markdown(ownerId, articleId))
      ),
    snapshotMarkdown: (input: unknown) =>
      strict(SnapshotIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId, snapshotId }) =>
          snapshotMarkdown(ownerId, articleId, snapshotId)
        )
      ),
    replayAccess: (input: unknown) =>
      strict(
        Schema.Struct({
          ownerId: OwnerIdSchema,
          snapshotId: SnapshotIdSchema,
          object: Schema.Union([
            Schema.Struct({ kind: Schema.Literal("Replay") }),
            Schema.Struct({
              kind: Schema.Literal("Asset"),
              assetName: Schema.String.check(
                Schema.isPattern(/^[a-f0-9]{64}\.[a-z0-9]{1,16}$/),
                Schema.isMaxLength(81)
              ),
            }),
          ]),
        })
      )(input).pipe(
        Effect.flatMap(({ ownerId, snapshotId, object }) =>
          replayAccess(ownerId, snapshotId, object)
        )
      ),
    patch: (input: unknown) =>
      strict(PatchInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId, patch }) =>
          parseArticleStatePatch(patch).pipe(
            Effect.mapError(invalidRequest),
            Effect.flatMap((trusted) =>
              dependencies.articles.patch(
                ownerId,
                articleId,
                trusted,
                dependencies.now()
              )
            )
          )
        )
      ),
    bulkPatch: (input: unknown) =>
      strict(BulkInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query, patch }) =>
          dependencies.articles.bulkPatch(
            ownerId,
            query,
            patch,
            dependencies.now()
          )
        )
      ),
    facets: (input: unknown) =>
      strict(FacetsInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query }) =>
          dependencies.articles.facets(ownerId, query)
        )
      ),
    archive: (input: unknown, context: ArchiveMessageContext) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) =>
          triggerArchive({ ownerId, articleId, context })
        )
      ),
  })
}
