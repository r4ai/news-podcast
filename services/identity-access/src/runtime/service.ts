import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { BetterAuthSessionApi } from "../adapters/better-auth-session-reader.js"
import { createSqliteGenerationSettingsRepository } from "../adapters/sqlite-generation-settings.js"
import type { GenerationSettingsRepository } from "../application/generation-settings.js"
import {
  createIdentityRuntimeResourceUnsafe,
  type UnsafeIdentityRuntimeResource,
} from "../infrastructure/unsafe/better-auth.js"
import { toIdentityAuthConfig, type IdentityAccessConfig } from "./env.js"
import {
  defaultNodeResolveSessionRpcDependencies,
  runNodeIdentityRpc,
  type NodeResolveSessionRpcError,
} from "./node.js"
import {
  makeCompleteScheduledGenerationHandler,
  makeFindDueGenerationSchedulesHandler,
  makeGetGenerationSettingsHandler,
  makeUpdateGenerationSettingsHandler,
} from "./generation-settings-handler.js"

export type IdentityAccessServiceError =
  | NodeResolveSessionRpcError
  | DeepReadonly<{
      readonly _tag: "IdentityAccessServiceFailed"
      readonly component: "Auth" | "Settings"
    }>

export type IdentityAccessRuntime = DeepReadonly<{
  readonly api: BetterAuthSessionApi
  readonly settings: {
    readonly get: ReturnType<typeof makeGetGenerationSettingsHandler>
    readonly update: ReturnType<typeof makeUpdateGenerationSettingsHandler>
    readonly findDue: ReturnType<typeof makeFindDueGenerationSchedulesHandler>
    readonly completeScheduled: ReturnType<
      typeof makeCompleteScheduledGenerationHandler
    >
  }
  readonly close: () => Effect.Effect<void>
}>

export type IdentityAccessRuntimeDependencies = Readonly<{
  readonly openRuntime: (
    config: ReturnType<typeof toIdentityAuthConfig>
  ) => Promise<UnsafeIdentityRuntimeResource>
  readonly createSettings: (
    database: UnsafeIdentityRuntimeResource["database"]
  ) => Effect.Effect<GenerationSettingsRepository, { readonly _tag: string }>
}>

export type IdentityAccessServiceDependencies = Readonly<{
  readonly startRuntime: (
    config: IdentityAccessConfig
  ) => Effect.Effect<IdentityAccessRuntime, IdentityAccessServiceError>
  readonly runRpc: (
    config: Readonly<{
      readonly natsServers: readonly string[]
      readonly queueGroup: string
    }>,
    api: BetterAuthSessionApi,
    settings: Pick<IdentityAccessRuntime["settings"], "get" | "update">,
    onReady?: () => void
  ) => Effect.Effect<void, NodeResolveSessionRpcError>
  readonly onReady?: () => void
}>

export const defaultIdentityAccessServiceDependencies: IdentityAccessServiceDependencies =
  deepFreeze({
    startRuntime: (config) => startIdentityAccessRuntime(config),
    runRpc: (config, api, settings, onReady) =>
      runNodeIdentityRpc(config, api, settings, {
        ...defaultNodeResolveSessionRpcDependencies,
        ...(onReady === undefined ? {} : { onReady }),
      }),
  })

const serviceFailure = (
  component: "Auth" | "Settings"
): IdentityAccessServiceError =>
  deepFreeze({
    _tag: "IdentityAccessServiceFailed" as const,
    component,
  })

const defaultRuntimeDependencies: IdentityAccessRuntimeDependencies =
  deepFreeze({
    openRuntime: createIdentityRuntimeResourceUnsafe,
    createSettings: createSqliteGenerationSettingsRepository,
  })

/** Transport-neutral seam sharing one SQLite handle across auth and settings. */
export const startIdentityAccessRuntime = (
  config: IdentityAccessConfig,
  dependencies: IdentityAccessRuntimeDependencies = defaultRuntimeDependencies
): Effect.Effect<IdentityAccessRuntime, IdentityAccessServiceError> =>
  Effect.tryPromise({
    try: () => dependencies.openRuntime(toIdentityAuthConfig(config)),
    catch: () => serviceFailure("Auth"),
  }).pipe(
    Effect.flatMap((resource) =>
      dependencies.createSettings(resource.database).pipe(
        Effect.mapError(() => serviceFailure("Settings")),
        Effect.map((repository) =>
          deepFreeze({
            api: resource.api,
            settings: deepFreeze({
              get: makeGetGenerationSettingsHandler(repository),
              update: makeUpdateGenerationSettingsHandler(repository),
              findDue: makeFindDueGenerationSchedulesHandler(repository),
              completeScheduled:
                makeCompleteScheduledGenerationHandler(repository),
            }),
            close: () =>
              Effect.try({
                try: resource.close,
                catch: () => serviceFailure("Auth"),
              }).pipe(
                Effect.tapError(() =>
                  Effect.logWarning("identity runtime close failed", {
                    event_name: "identity.runtime.close",
                  })
                ),
                Effect.ignore
              ),
          })
        ),
        Effect.tapError(() => Effect.sync(resource.close).pipe(Effect.ignore))
      )
    )
  )

/** NATS scope is nested inside auth ownership, so NATS drains before DB close. */
export const runIdentityAccessService = (
  config: IdentityAccessConfig,
  dependencies: IdentityAccessServiceDependencies = defaultIdentityAccessServiceDependencies
): Effect.Effect<void, IdentityAccessServiceError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Effect.acquireRelease(
        dependencies.startRuntime(config),
        (resource) => resource.close()
      )

      return yield* dependencies.runRpc(
        {
          natsServers: config.natsServers,
          queueGroup: config.queueGroup,
        },
        runtime.api,
        runtime.settings,
        dependencies.onReady
      )
    })
  )
