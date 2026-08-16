import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import {
  logRpcDeliveryFailure,
  runSequentialRpcLoop,
} from "@news-podcast/nats-runtime"
import { subjects } from "@news-podcast/protocols"
import { Effect } from "effect"

import { materializeArticles } from "../../application/materialize-articles.js"
import type { createGenerationPlanning } from "../../application/generation-planning.js"
import type { MarkdownObjectReader } from "../../application/ports/article-catalog.js"
import {
  currentCapturedAtUnsafe,
  randomMessageIdUnsafe,
  randomSubscriptionIdentityUnsafe,
} from "../../infrastructure/unsafe/identity.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../../infrastructure/unsafe/nats-rpc.js"
import { makeContentKnowledgeRpcHandler } from "./dispatch.js"
import { makeArticleLibraryRpcHandler } from "./article-library.js"
import { makePersonalizationRpcHandler } from "./personalization.js"
import type { makeArticleLibraryHandler } from "./article-library-handler.js"
import type { NodeContentKnowledgeRuntime, NodeRuntimeError } from "../node.js"
import type { FeedPollWakeup } from "../loops/feed-poll.js"

export type ContentKnowledgeRpcServerConfig = DeepReadonly<{
  readonly natsServers: readonly string[]
  readonly queueGroup: string
  readonly onReady?: () => void
}>

export type ContentKnowledgeRpcServerDependencies = Readonly<{
  readonly connect: (
    servers: readonly string[],
    subjects: readonly string[],
    queueGroup: string
  ) => Promise<UnsafeNatsRpcServer>
  readonly newSubscriptionIdentity: typeof randomSubscriptionIdentityUnsafe
  readonly newMessageId: () => string
  readonly now: () => string
}>

const defaultDependencies: ContentKnowledgeRpcServerDependencies =
  Object.freeze({
    connect: connectNatsRpcUnsafe,
    newSubscriptionIdentity: randomSubscriptionIdentityUnsafe,
    newMessageId: randomMessageIdUnsafe,
    now: currentCapturedAtUnsafe,
  })

const runtimeFailure = (): NodeRuntimeError =>
  deepFreeze({ _tag: "ContentKnowledgeRuntimeFailed", component: "Nats" })

/** Serves all owner-scoped Content RPCs over one queue-group connection. */
export const runNatsContentKnowledgeRpc = (
  config: ContentKnowledgeRpcServerConfig,
  runtime: Pick<NodeContentKnowledgeRuntime, "articles" | "subscriptions"> &
    Partial<Pick<NodeContentKnowledgeRuntime, "feedSyncQueue">>,
  objects: MarkdownObjectReader,
  dependencies: ContentKnowledgeRpcServerDependencies = defaultDependencies,
  articleLibrary?: ReturnType<typeof makeArticleLibraryHandler>,
  personalization?: Parameters<typeof makePersonalizationRpcHandler>[0],
  generationPlanning?: ReturnType<typeof createGenerationPlanning>,
  pollerWakeup?: Pick<FeedPollWakeup, "notify">
): Effect.Effect<void, NodeRuntimeError> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          dependencies.connect(
            config.natsServers,
            [
              subjects.content.addSubscription,
              subjects.content.listSubscriptions,
              subjects.content.deleteSubscription,
              subjects.content.syncSubscription,
              subjects.content.updateSubscription,
              subjects.content.listFeedCatalog,
              subjects.content.listFeedSyncJobs,
              subjects.content.materializeArticles,
              subjects.content.planGeneration,
              subjects.content.articleLibrary,
              subjects.content.personalization,
            ],
            config.queueGroup
          ),
        catch: runtimeFailure,
      }),
      (server) => Effect.tryPromise(() => server.drain()).pipe(Effect.ignore)
    ).pipe(
      Effect.flatMap((server) => {
        const handler = makeContentKnowledgeRpcHandler(
          runtime.subscriptions,
          materializeArticles({ catalog: runtime.articles, objects }),
          {
            ...dependencies,
            onSubscriptionAdded: pollerWakeup?.notify,
          },
          runtime.feedSyncQueue,
          generationPlanning
        )
        const libraryHandler =
          articleLibrary === undefined
            ? undefined
            : makeArticleLibraryRpcHandler(articleLibrary, dependencies)
        const personalizationHandler =
          personalization === undefined
            ? undefined
            : makePersonalizationRpcHandler(personalization, dependencies)
        config.onReady?.()
        return runSequentialRpcLoop({
          receive: Effect.tryPromise({
            try: () => server.receive(),
            catch: runtimeFailure,
          }),
          sourceClosed: runtimeFailure,
          handle: (delivery) => {
            const selected =
              delivery.subject === subjects.content.articleLibrary &&
              libraryHandler !== undefined
                ? libraryHandler
                : delivery.subject === subjects.content.personalization &&
                    personalizationHandler !== undefined
                  ? personalizationHandler
                  : handler
            return selected({
              subject: delivery.subject,
              payload: delivery.payload,
              reply: (payload) =>
                Effect.tryPromise({
                  try: () => delivery.reply(payload),
                  catch: runtimeFailure,
                }),
            }).pipe(Effect.mapError(() => runtimeFailure()))
          },
          onDeliveryFailure: (cause) =>
            logRpcDeliveryFailure("content-knowledge", "rpc", cause),
        })
      })
    )
  )
