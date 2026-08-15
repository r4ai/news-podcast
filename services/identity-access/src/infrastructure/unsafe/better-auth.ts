import { timingSafeEqual } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { openDatabaseClientUnsafe } from "@news-podcast/persistence"
import { betterAuth } from "better-auth"

import type { BetterAuthSessionApi } from "../../adapters/better-auth-session-reader.js"
import {
  attachIdentityDatabaseUnsafe,
  type IdentityDatabase,
} from "./drizzle/open.js"

export type DevBearerAuthConfig =
  | Readonly<{ readonly enabled: false }>
  | Readonly<{
      readonly enabled: true
      readonly token: string
      readonly userId: string
    }>

export type IdentityAuthConfig = Readonly<{
  readonly databasePath: string
  readonly secret: string
  readonly baseUrl: string
  readonly devAuth: DevBearerAuthConfig
  readonly google?: Readonly<{
    readonly clientId: string
    readonly clientSecret: string
  }>
}>

export type UnsafeIdentityAuth = DeepReadonly<{
  readonly api: BetterAuthSessionApi
  readonly close: () => void
}>

/**
 * DeepReadonlyはドメイン値のための道具であり、ORMハンドルに適用すると
 * 型パラメータが潰れる。この資源はReadonlyで十分。
 */
export type UnsafeIdentityRuntimeResource = Readonly<{
  readonly api: BetterAuthSessionApi
  readonly handler: (request: Request) => Promise<Response>
  readonly database: IdentityDatabase
  readonly close: () => void
}>

const exactSecretMatch = (candidate: string, expected: string): boolean => {
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  )
}

export const makeIdentitySessionApi = (
  api: BetterAuthSessionApi,
  devAuth: DevBearerAuthConfig
): BetterAuthSessionApi =>
  deepFreeze({
    getSession: (input) => {
      const authorization = input.headers.get("authorization")
      if (
        devAuth.enabled &&
        authorization?.startsWith("Bearer ") === true &&
        exactSecretMatch(authorization.slice("Bearer ".length), devAuth.token)
      ) {
        return Promise.resolve(
          deepFreeze({ user: deepFreeze({ id: devAuth.userId }) })
        )
      }
      return api.getSession(input)
    },
  })

/** Owns Better Auth schema migration and its service-specific SQLite handle. */
const createIdentitySessionApiUnsafe = async (
  config: IdentityAuthConfig,
  database: DatabaseSync
): Promise<
  Readonly<{
    api: BetterAuthSessionApi
    handler: (request: Request) => Promise<Response>
  }>
> => {
  const auth = betterAuth({
    appName: "RSS News Podcast Identity",
    secret: config.secret,
    baseURL: config.baseUrl,
    database,
    ...(config.google === undefined
      ? {}
      : {
          socialProviders: {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
            },
          },
        }),
  })
  const context = await auth.$context
  await context.runMigrations()
  const sessionApi: BetterAuthSessionApi = deepFreeze({
    getSession: (input) => auth.api.getSession(input),
  })
  const api = makeIdentitySessionApi(sessionApi, config.devAuth)
  return deepFreeze({ api, handler: (request) => auth.handler(request) })
}

/** Opens one SQLite handle shared by Better Auth and Identity-owned settings. */
export const createIdentityRuntimeResourceUnsafe = async (
  config: IdentityAuthConfig
): Promise<UnsafeIdentityRuntimeResource> => {
  const client = openDatabaseClientUnsafe({ path: config.databasePath })
  try {
    const database = attachIdentityDatabaseUnsafe(client)
    const auth = await createIdentitySessionApiUnsafe(config, client)
    // ORMハンドルは可変な内部状態を持つ資源であり、凍結対象はこの容れ物だけ。
    return Object.freeze({
      api: auth.api,
      handler: auth.handler,
      database,
      close: () => client.close(),
    })
  } catch (error) {
    client.close()
    throw error
  }
}

/** Backward-compatible auth-only resource for focused adapter callers. */
export const createIdentityAuthUnsafe = async (
  config: IdentityAuthConfig
): Promise<UnsafeIdentityAuth> => {
  const resource = await createIdentityRuntimeResourceUnsafe(config)
  return deepFreeze({ api: resource.api, close: resource.close })
}
