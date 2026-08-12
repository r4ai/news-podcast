import { timingSafeEqual } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { betterAuth } from "better-auth"

import type { BetterAuthSessionApi } from "../../adapters/better-auth-session-reader.js"

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
export const createIdentityAuthUnsafe = async (
  config: IdentityAuthConfig
): Promise<UnsafeIdentityAuth> => {
  const database = new DatabaseSync(config.databasePath)
  try {
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
    const api: BetterAuthSessionApi = deepFreeze({
      getSession: (input) => auth.api.getSession(input),
    })
    return deepFreeze({
      api: makeIdentitySessionApi(api, config.devAuth),
      close: () => database.close(),
    })
  } catch (error) {
    database.close()
    throw error
  }
}
