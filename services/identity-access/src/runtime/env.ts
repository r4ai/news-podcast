import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import { UserIdSchema } from "../domain/actor.js"
import type { IdentityAuthConfig } from "../infrastructure/unsafe/better-auth.js"
import { NodeResolveSessionRpcConfigSchema } from "./node.js"

const DatabasePathSchema = Schema.NonEmptyString.check(
  Schema.isTrimmed(),
  Schema.isMaxLength(4_096),
  Schema.makeFilter<string>((value) =>
    value === ":memory:"
      ? "Expected a persistent Identity database path"
      : undefined
  )
)
const HttpUrlSchema = Schema.String.check(
  Schema.makeFilter<string>((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
        ? undefined
        : "Expected an HTTP URL without credentials"
    } catch {
      return "Expected an absolute HTTP URL"
    }
  })
)
const SecretSchema = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(4_096)
)
const DevAuthSchema = Schema.Union([
  Schema.Struct({ enabled: Schema.Literal(false) }),
  Schema.Struct({
    enabled: Schema.Literal(true),
    token: Schema.NonEmptyString.check(Schema.isMaxLength(4_096)),
    userId: UserIdSchema,
  }),
])
const GoogleSchema = Schema.Struct({
  clientId: Schema.NonEmptyString.check(Schema.isMaxLength(1_024)),
  clientSecret: Schema.NonEmptyString.check(Schema.isMaxLength(4_096)),
})

export const IdentityAccessConfigSchema = Schema.Struct({
  httpHost: Schema.NonEmptyString.check(Schema.isMaxLength(255)),
  httpPort: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  databasePath: DatabasePathSchema,
  secret: SecretSchema,
  baseUrl: HttpUrlSchema,
  appEnvironment: Schema.Literals(["development", "test", "production"]),
  natsServers: NodeResolveSessionRpcConfigSchema.fields.natsServers,
  queueGroup: NodeResolveSessionRpcConfigSchema.fields.queueGroup,
  devAuth: DevAuthSchema,
  google: Schema.optional(GoogleSchema),
})
export type IdentityAccessConfig = DeepReadonly<
  Schema.Schema.Type<typeof IdentityAccessConfigSchema>
>
const parseConfig = parse(IdentityAccessConfigSchema)

const configFailure = () =>
  deepFreeze({
    _tag: "IdentityAccessConfigFailed" as const,
  })

const parseBoolean = (input: string | undefined) => {
  if (input === undefined || input.trim() === "") return Effect.succeed(false)
  if (input === "true") return Effect.succeed(true)
  if (input === "false") return Effect.succeed(false)
  return Effect.fail(configFailure())
}

export const toIdentityAuthConfig = (
  config: IdentityAccessConfig
): IdentityAuthConfig =>
  deepFreeze({
    databasePath: config.databasePath,
    secret: config.secret,
    baseUrl: config.baseUrl,
    devAuth: config.devAuth,
    ...(config.google === undefined ? {} : { google: config.google }),
  })

export const readIdentityAccessConfig = (
  env: Readonly<Record<string, string | undefined>>
) =>
  Effect.gen(function* () {
    const devEnabled = yield* parseBoolean(env.DEV_AUTH_ENABLED)
    const appEnvironment = env.APP_ENV?.trim() || "development"
    if (devEnabled && appEnvironment === "production") {
      return yield* Effect.fail(configFailure())
    }
    const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || undefined
    const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || undefined
    if ((googleClientId === undefined) !== (googleClientSecret === undefined)) {
      return yield* Effect.fail(configFailure())
    }
    const natsServers = (env.NATS_SERVERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    return yield* parseConfig({
      httpHost: env.IDENTITY_HTTP_HOST?.trim() || "0.0.0.0",
      httpPort: Number(env.IDENTITY_HTTP_PORT ?? "4002"),
      databasePath: env.IDENTITY_DATABASE_PATH?.trim() ?? "",
      secret: env.BETTER_AUTH_SECRET ?? "",
      baseUrl: env.BETTER_AUTH_URL?.trim() ?? "",
      appEnvironment,
      natsServers,
      queueGroup: env.IDENTITY_QUEUE_GROUP?.trim() ?? "",
      devAuth: devEnabled
        ? {
            enabled: true,
            token: env.DEV_AUTH_PASSWORD ?? "",
            userId: env.DEV_AUTH_USER_ID?.trim() ?? "",
          }
        : { enabled: false },
      ...(googleClientId === undefined
        ? {}
        : {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          }),
    }).pipe(Effect.mapError(configFailure))
  })
