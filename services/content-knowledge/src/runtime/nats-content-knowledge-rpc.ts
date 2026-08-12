import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect } from "effect"

import { materializeArticles } from "../application/materialize-articles.js"
import type { MarkdownObjectReader } from "../application/article-catalog-ports.js"
import {
  currentCapturedAtUnsafe,
  randomMessageIdUnsafe,
  randomSubscriptionIdentityUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../infrastructure/unsafe/nats-rpc.js"
import { makeContentKnowledgeRpcHandler } from "./content-knowledge-rpc.js"
import type { NodeContentKnowledgeRuntime, NodeRuntimeError } from "./node.js"

export type ContentKnowledgeRpcServerConfig = DeepReadonly<{
  readonly natsServers: readonly string[]
  readonly queueGroup: string
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
  runtime: Pick<NodeContentKnowledgeRuntime, "articles" | "subscriptions">,
  objects: MarkdownObjectReader,
  dependencies: ContentKnowledgeRpcServerDependencies = defaultDependencies
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
              subjects.content.materializeArticles,
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
          dependencies
        )
        const loop = (): Effect.Effect<void, NodeRuntimeError> =>
          Effect.tryPromise({
            try: () => server.receive(),
            catch: runtimeFailure,
          }).pipe(
            Effect.flatMap((delivery) => {
              if (delivery === undefined) return Effect.void
              return handler({
                subject: delivery.subject,
                payload: delivery.payload,
                reply: (payload) =>
                  Effect.tryPromise({
                    try: () => delivery.reply(payload),
                    catch: runtimeFailure,
                  }),
              }).pipe(
                Effect.mapError(() => runtimeFailure()),
                Effect.andThen(loop())
              )
            })
          )
        return loop()
      })
    )
  )
