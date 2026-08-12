import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { BetterAuthSessionApi } from "../adapters/better-auth-session-reader.js"
import {
  createIdentityAuthUnsafe,
  type UnsafeIdentityAuth,
} from "../infrastructure/unsafe/better-auth.js"
import { toIdentityAuthConfig, type IdentityAccessConfig } from "./env.js"
import {
  runNodeResolveSessionRpc,
  type NodeResolveSessionRpcError,
} from "./node.js"

export type IdentityAccessServiceError =
  | NodeResolveSessionRpcError
  | DeepReadonly<{
      readonly _tag: "IdentityAccessServiceFailed"
      readonly component: "Auth"
    }>

export type IdentityAccessServiceDependencies = Readonly<{
  readonly createAuth: (
    config: ReturnType<typeof toIdentityAuthConfig>
  ) => Promise<UnsafeIdentityAuth>
  readonly runRpc: (
    config: Readonly<{
      readonly natsServers: readonly string[]
      readonly queueGroup: string
    }>,
    api: BetterAuthSessionApi
  ) => Effect.Effect<void, NodeResolveSessionRpcError>
}>

const defaultDependencies: IdentityAccessServiceDependencies = deepFreeze({
  createAuth: createIdentityAuthUnsafe,
  runRpc: runNodeResolveSessionRpc,
})

const authFailure = (): IdentityAccessServiceError =>
  deepFreeze({
    _tag: "IdentityAccessServiceFailed" as const,
    component: "Auth" as const,
  })

/** NATS scope is nested inside auth ownership, so NATS drains before DB close. */
export const runIdentityAccessService = (
  config: IdentityAccessConfig,
  dependencies: IdentityAccessServiceDependencies = defaultDependencies
): Effect.Effect<void, IdentityAccessServiceError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const auth = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => dependencies.createAuth(toIdentityAuthConfig(config)),
          catch: authFailure,
        }),
        (resource) => Effect.sync(() => resource.close())
      )

      return yield* dependencies.runRpc(
        {
          natsServers: config.natsServers,
          queueGroup: config.queueGroup,
        },
        auth.api
      )
    })
  )
