import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { handleCreateJobRpc } from "../adapters/create-job-rpc.js"
import {
  handleCancelJobRpc,
  handleGetJobRpc,
  handleListJobsRpc,
  handleListJobEventsRpc,
  handleRetryJobRpc,
  type JobControlRpcDelivery,
} from "../adapters/job-control-rpc.js"
import { retryFailedJob } from "../application/job-control.js"
import { sqliteJobRepository } from "../adapters/sqlite-job-repository.js"
import {
  UtcTimestampSchema,
  type JobId,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import {
  currentUtcTimestampUnsafe,
  randomJobIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../infrastructure/unsafe/nats-rpc.js"
import { runSingleWriterLoop } from "./single-writer-loop.js"

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))

export const NodeCreateJobRpcConfigSchema = Schema.Struct({
  sqlitePath: Schema.NonEmptyString.check(Schema.isMaxLength(4_096)),
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  queueGroup: Schema.NonEmptyString.check(
    Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
  ),
})
export const parseNodeCreateJobRpcConfig = parse(NodeCreateJobRpcConfigSchema)

export type NodeCreateJobRpcError = DeepReadonly<{
  readonly _tag: "NodeCreateJobRpcFailed"
  readonly component: "Config" | "Nats" | "Reply" | "Sqlite"
}>

export type NodeCreateJobRpcDependencies = DeepReadonly<{
  readonly connectNats: (
    servers: readonly string[],
    subject: string,
    queueGroup: string
  ) => Promise<UnsafeNatsRpcServer>
  readonly newJobId: () => JobId
  readonly now: () => UtcTimestamp
}>

const defaultDependencies: NodeCreateJobRpcDependencies = deepFreeze({
  connectNats: connectNatsRpcUnsafe,
  newJobId: randomJobIdUnsafe,
  now: currentUtcTimestampUnsafe,
})

const runtimeError = (
  component: NodeCreateJobRpcError["component"]
): NodeCreateJobRpcError =>
  deepFreeze({ _tag: "NodeCreateJobRpcFailed" as const, component })

/** Complete scoped runtime: SQLite and NATS are released on every exit path. */
export const runNodeCreateJobRpc = (
  input: unknown,
  dependencies: NodeCreateJobRpcDependencies = defaultDependencies
): Effect.Effect<void, NodeCreateJobRpcError> =>
  parseNodeCreateJobRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* sqliteJobRepository(config.sqlitePath).pipe(
            Effect.mapError(() => runtimeError("Sqlite"))
          )
          const server = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectNats(
                  config.natsServers,
                  subjects.production.createJob,
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          const handler = handleCreateJobRpc({
            nextJobId: Effect.sync(dependencies.newJobId),
            now: Effect.sync(dependencies.now),
            saveIdempotently: repository.saveIdempotently,
          })

          return yield* runSingleWriterLoop(
            {
              receive: Effect.tryPromise({
                try: () => server.receive(),
                catch: () => runtimeError("Nats"),
              }),
            },
            (delivery) =>
              handler({
                payload: delivery.payload,
                reply: (payload) =>
                  Effect.tryPromise({
                    try: () => delivery.reply(payload),
                    catch: () => runtimeError("Reply"),
                  }),
              })
          )
        })
      )
    )
  )

type RpcHandler = (
  delivery: JobControlRpcDelivery<NodeCreateJobRpcError>
) => Effect.Effect<void, NodeCreateJobRpcError>

/** Runs the complete versioned Episode Production command/query RPC surface. */
export const runNodeProductionRpc = (
  input: unknown,
  dependencies: NodeCreateJobRpcDependencies = defaultDependencies
): Effect.Effect<void, NodeCreateJobRpcError> =>
  parseNodeCreateJobRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* sqliteJobRepository(config.sqlitePath).pipe(
            Effect.mapError(() => runtimeError("Sqlite"))
          )
          const now = Effect.sync(dependencies.now)
          const replyDependencies = {
            newMessageId: () => dependencies.newJobId(),
            now: () =>
              Schema.encodeSync(UtcTimestampSchema)(dependencies.now()),
          }
          const handlers: readonly (readonly [string, RpcHandler])[] = [
            [
              subjects.production.createJob,
              handleCreateJobRpc({
                nextJobId: Effect.sync(dependencies.newJobId),
                now,
                saveIdempotently: repository.saveIdempotently,
              }),
            ],
            [
              subjects.production.getJob,
              handleGetJobRpc({
                findOwned: repository.findOwned,
                replyDependencies,
              }),
            ],
            [
              subjects.production.listJobs,
              handleListJobsRpc({
                listOwned: repository.listOwned,
                replyDependencies,
              }),
            ],
            [
              subjects.production.listJobEvents,
              handleListJobEventsRpc({
                findOwned: repository.findOwned,
                listOwnedStatusEvents: repository.listOwnedStatusEvents,
                replyDependencies,
              }),
            ],
            [
              subjects.production.cancelJob,
              handleCancelJobRpc({
                now,
                cancelOwned: repository.cancelOwned,
                replyDependencies,
              }),
            ],
            [
              subjects.production.retryJob,
              handleRetryJobRpc({
                retry: (ownerId, jobId, idempotencyKey) =>
                  retryFailedJob(
                    {
                      findOwned: repository.findOwned,
                      nextJobId: Effect.sync(dependencies.newJobId),
                      now,
                      saveIdempotently: repository.saveIdempotently,
                    },
                    ownerId,
                    jobId,
                    idempotencyKey
                  ),
                replyDependencies,
              }),
            ],
          ]

          yield* Effect.all(
            handlers.map(([subject, handler]) =>
              Effect.gen(function* () {
                const server = yield* Effect.acquireRelease(
                  Effect.tryPromise({
                    try: () =>
                      dependencies.connectNats(
                        config.natsServers,
                        subject,
                        config.queueGroup
                      ),
                    catch: () => runtimeError("Nats"),
                  }),
                  (resource) =>
                    Effect.tryPromise(() => resource.drain()).pipe(
                      Effect.ignore
                    )
                )
                yield* runSingleWriterLoop(
                  {
                    receive: Effect.tryPromise({
                      try: () => server.receive(),
                      catch: () => runtimeError("Nats"),
                    }),
                  },
                  (delivery) =>
                    handler({
                      payload: delivery.payload,
                      reply: (payload) =>
                        Effect.tryPromise({
                          try: () => delivery.reply(payload),
                          catch: () => runtimeError("Reply"),
                        }),
                    })
                )
              })
            ),
            { concurrency: "unbounded", discard: true }
          )
        })
      )
    )
  )
