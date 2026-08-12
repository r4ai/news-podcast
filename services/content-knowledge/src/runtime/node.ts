import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  createJetStreamPublisher,
  createSqliteArchiveStore,
  OutboxBatchSizeSchema,
  parseOutboxLimit,
  relayOutbox,
  type OutboxPublisherError,
  type OutboxStoreError,
  type RelayResult,
  type SqlitePort,
  type SqliteArchiveStore,
} from "../adapters/index.js"
import type { CapturedAt } from "../domain/article.js"
import {
  currentCapturedAtUnsafe,
  randomMessageIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectJetStreamUnsafe,
  type UnsafeJetStream,
} from "../infrastructure/unsafe/nats-jetstream.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import {
  runOutboxRelayLoop,
  type OutboxRelayLoopRuntime,
} from "./outbox-relay-loop.js"

const SqlitePathSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096)
).pipe(Schema.brand("SqlitePath"))

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))

export const NodeRuntimeConfigSchema = Schema.Struct({
  sqlitePath: SqlitePathSchema,
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
})
export const parseNodeRuntimeConfig = parse(NodeRuntimeConfigSchema)

const RelayDelaySchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(300_000)
)
export const NodeServiceConfigSchema = Schema.Struct({
  sqlitePath: SqlitePathSchema,
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  relay: Schema.Struct({
    batchSize: OutboxBatchSizeSchema,
    intervalMillis: RelayDelaySchema,
    initialBackoffMillis: RelayDelaySchema,
    maximumBackoffMillis: RelayDelaySchema,
  }),
})
const parseNodeServiceStructure = parse(NodeServiceConfigSchema)
export const parseNodeServiceConfig = (input: unknown) =>
  parseNodeServiceStructure(input).pipe(
    Effect.filterOrFail(
      (config) =>
        config.relay.initialBackoffMillis <= config.relay.maximumBackoffMillis,
      () => deepFreeze({ _tag: "InvalidBackoffRange" as const })
    )
  )

export type NodeRuntimeError = DeepReadonly<{
  readonly _tag: "ContentKnowledgeRuntimeFailed"
  readonly component: "Config" | "Nats" | "Outbox" | "Sqlite"
}>

export type NodeContentKnowledgeRuntime = DeepReadonly<{
  readonly store: SqliteArchiveStore
  readonly relayOnce: (
    input: unknown
  ) => Effect.Effect<
    RelayResult,
    NodeRuntimeError | OutboxPublisherError | OutboxStoreError
  >
  readonly close: () => Effect.Effect<void, NodeRuntimeError>
}>

export type NodeRuntimeDependencies = DeepReadonly<{
  readonly openSqlite: (path: string) => SqlitePort
  readonly connectJetStream: (
    servers: readonly string[]
  ) => Promise<UnsafeJetStream>
  readonly newMessageId: typeof randomMessageIdUnsafe
  readonly now: () => CapturedAt
}>

export type NodeServiceDependencies = Readonly<{
  readonly startRuntime: (
    input: unknown
  ) => Effect.Effect<NodeContentKnowledgeRuntime, NodeRuntimeError>
  readonly relayRuntime: Partial<OutboxRelayLoopRuntime>
}>

const defaultDependencies: NodeRuntimeDependencies = deepFreeze({
  openSqlite: openSqliteUnsafe,
  connectJetStream: connectJetStreamUnsafe,
  newMessageId: randomMessageIdUnsafe,
  now: currentCapturedAtUnsafe,
})
const jsonInterop = deepFreeze({
  parse: parseJsonUnsafe,
  stringify: stringifyJsonUnsafe,
})

const runtimeError = (
  component: NodeRuntimeError["component"]
): NodeRuntimeError =>
  deepFreeze({ _tag: "ContentKnowledgeRuntimeFailed" as const, component })

const closeSqlite = (
  database: SqlitePort
): Effect.Effect<void, NodeRuntimeError> =>
  Effect.try({
    try: () => database.close(),
    catch: () => runtimeError("Sqlite"),
  })

export const startNodeRuntime = (
  input: unknown,
  dependencies: NodeRuntimeDependencies = defaultDependencies
): Effect.Effect<NodeContentKnowledgeRuntime, NodeRuntimeError> =>
  parseNodeRuntimeConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.try({
        try: () => dependencies.openSqlite(config.sqlitePath),
        catch: () => runtimeError("Sqlite"),
      }).pipe(
        Effect.flatMap((database) =>
          createSqliteArchiveStore(
            database,
            dependencies.newMessageId,
            jsonInterop
          ).pipe(
            Effect.mapError(() => runtimeError("Sqlite")),
            Effect.flatMap((store) =>
              Effect.tryPromise({
                try: () => dependencies.connectJetStream(config.natsServers),
                catch: () => runtimeError("Nats"),
              }).pipe(
                Effect.map((jetStream) => {
                  const publisher = createJetStreamPublisher(jetStream)
                  const relay = relayOutbox({
                    store,
                    publisher,
                    now: dependencies.now,
                  })
                  const relayOnce = (batchSize: unknown) =>
                    parseOutboxLimit(batchSize).pipe(
                      Effect.mapError(() => runtimeError("Outbox")),
                      Effect.flatMap(relay)
                    )
                  const close = () =>
                    Effect.tryPromise({
                      try: () => jetStream.close(),
                      catch: () => runtimeError("Nats"),
                    }).pipe(
                      Effect.matchEffect({
                        onFailure: (natsError) =>
                          closeSqlite(database).pipe(
                            Effect.matchEffect({
                              onFailure: () => Effect.fail(natsError),
                              onSuccess: () => Effect.fail(natsError),
                            })
                          ),
                        onSuccess: () => closeSqlite(database),
                      })
                    )

                  return deepFreeze({ store, relayOnce, close })
                })
              )
            ),
            Effect.tapError(() => closeSqlite(database).pipe(Effect.ignore))
          )
        )
      )
    )
  )

const defaultServiceDependencies: NodeServiceDependencies = Object.freeze({
  startRuntime: startNodeRuntime,
  relayRuntime: Object.freeze({}),
})

/** Owns the continuously running relay and releases SQLite/NATS on interruption. */
export const runNodeService = (
  input: unknown,
  dependencies: NodeServiceDependencies = defaultServiceDependencies
): Effect.Effect<void, NodeRuntimeError> =>
  parseNodeServiceConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.acquireRelease(
          dependencies.startRuntime({
            sqlitePath: config.sqlitePath,
            natsServers: config.natsServers,
          }),
          (runtime) =>
            runtime.close().pipe(
              Effect.tapError((failure) =>
                Effect.logWarning("content runtime close failed", {
                  event_name: "content.runtime.close",
                  component: failure.component,
                })
              ),
              Effect.ignore
            )
        ).pipe(
          Effect.flatMap((runtime) =>
            runOutboxRelayLoop(
              config.relay,
              runtime.relayOnce,
              dependencies.relayRuntime
            )
          )
        )
      )
    )
  )
