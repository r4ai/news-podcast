import { openProductionDatabaseUnsafe } from "../infrastructure/unsafe/drizzle/open.js"
import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { handleCreateJobRpc } from "../adapters/rpc/create-job.js"
import {
  handleCancelJobRpc,
  handleGetJobRpc,
  handleListJobsRpc,
  handleListJobEventsRpc,
  handleRetryJobRpc,
  type JobControlRpcDelivery,
} from "../adapters/rpc/job-control.js"
import { retryFailedJob } from "../application/job-control.js"
import { jobRepository } from "../adapters/persistence/job/repository.js"
import { readingDictionaryRepository } from "../adapters/persistence/reading-dictionary/repository.js"
import {
  makeReadingDictionaryRpcHandler,
  type ReadingDictionaryRpcDelivery,
} from "../adapters/rpc/reading-dictionary.js"
import {
  UtcTimestampSchema,
  type JobId,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import { ReadingDictionaryIdSchema } from "../domain/reading-dictionary.js"
import {
  currentUtcTimestampUnsafe,
  randomJobIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../infrastructure/unsafe/nats-rpc.js"
import { runSingleWriterLoop } from "./loops/single-writer.js"

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
  readonly component: "Config" | "Handler" | "Nats" | "Reply" | "Sqlite"
}>

export type NodeCreateJobRpcDependencies = DeepReadonly<{
  readonly connectNats: (
    servers: readonly string[],
    subject: string | readonly string[],
    queueGroup: string
  ) => Promise<UnsafeNatsRpcServer>
  readonly newJobId: () => JobId
  readonly now: () => UtcTimestamp
  readonly onReady?: () => void
}>

export const defaultNodeCreateJobRpcDependencies: NodeCreateJobRpcDependencies =
  deepFreeze({
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
  dependencies: NodeCreateJobRpcDependencies = defaultNodeCreateJobRpcDependencies
): Effect.Effect<void, NodeCreateJobRpcError> =>
  parseNodeCreateJobRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          // 接続はプロセスにつき1本。以前は同じDBへ最大6本を開いていた。
          const database = yield* Effect.acquireRelease(
            Effect.try({
              try: () => openProductionDatabaseUnsafe(config.sqlitePath),
              catch: () => runtimeError("Sqlite"),
            }),
            (handle) => Effect.sync(() => handle.close())
          )
          const repository = yield* jobRepository(database.database).pipe(
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
          dependencies.onReady?.()

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
              }),
            () => runtimeError("Nats"),
            subjects.production.createJob
          )
        })
      )
    )
  )

type RpcHandler = (
  delivery:
    | JobControlRpcDelivery<NodeCreateJobRpcError>
    | ReadingDictionaryRpcDelivery<NodeCreateJobRpcError>
) => Effect.Effect<void, unknown, never>

/** Runs the complete versioned Episode Production command/query RPC surface. */
export const runNodeProductionRpc = (
  input: unknown,
  dependencies: NodeCreateJobRpcDependencies = defaultNodeCreateJobRpcDependencies
): Effect.Effect<void, NodeCreateJobRpcError> =>
  parseNodeCreateJobRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          // 接続はプロセスにつき1本。以前は同じDBへ最大6本を開いていた。
          const database = yield* Effect.acquireRelease(
            Effect.try({
              try: () => openProductionDatabaseUnsafe(config.sqlitePath),
              catch: () => runtimeError("Sqlite"),
            }),
            (handle) => Effect.sync(() => handle.close())
          )
          const repository = yield* jobRepository(database.database).pipe(
            Effect.mapError(() => runtimeError("Sqlite"))
          )
          const dictionary = yield* readingDictionaryRepository(
            database.database
          ).pipe(Effect.mapError(() => runtimeError("Sqlite")))
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
                listOwnedAgUiEvents: repository.listOwnedAgUiEvents,
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
            [
              subjects.production.readingDictionary,
              makeReadingDictionaryRpcHandler(dictionary, {
                newId: () =>
                  Schema.decodeUnknownSync(ReadingDictionaryIdSchema)(
                    dependencies.newJobId()
                  ),
                newMessageId: dependencies.newJobId,
                now: dependencies.now,
              }),
            ],
          ]

          const handlerBySubject = new Map(handlers)
          const server = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectNats(
                  config.natsServers,
                  handlers.map(([subject]) => subject),
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          dependencies.onReady?.()
          yield* runSingleWriterLoop(
            {
              receive: Effect.tryPromise({
                try: () => server.receive(),
                catch: () => runtimeError("Nats"),
              }),
            },
            (delivery) => {
              const handler =
                delivery.subject === undefined
                  ? undefined
                  : handlerBySubject.get(delivery.subject)
              if (handler === undefined) {
                return Effect.fail(runtimeError("Handler"))
              }
              return handler({
                payload: delivery.payload,
                reply: (payload) =>
                  Effect.tryPromise({
                    try: () => delivery.reply(payload),
                    catch: () => runtimeError("Reply"),
                  }),
              }).pipe(
                Effect.mapError((failure) =>
                  typeof failure === "object" &&
                  failure !== null &&
                  "_tag" in failure &&
                  failure._tag === "NodeCreateJobRpcFailed"
                    ? (failure as NodeCreateJobRpcError)
                    : runtimeError("Handler")
                )
              )
            },
            () => runtimeError("Nats"),
            "rpc"
          )
        })
      )
    )
  )
