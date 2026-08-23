import { parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

const ProviderRuntimeModeSchema = Schema.Struct({
  appEnvironment: Schema.Literals(["development", "test", "production"]),
  providerMode: Schema.Literals(["fake", "live"]),
})

/** Shared fail-closed projection for services that select fake/live providers. */
export const readProviderRuntimeMode = (
  environment: Readonly<Record<string, string | undefined>>
) => {
  const appEnvironment = environment.APP_ENV?.trim() || "development"
  const providerMode = environment.PROVIDER_MODE?.trim() || "fake"

  return parse(ProviderRuntimeModeSchema)({
    appEnvironment,
    providerMode,
  }).pipe(
    Effect.filterOrFail(
      (config) =>
        config.appEnvironment !== "production" ||
        config.providerMode === "live",
      () => ({ _tag: "UnsafeProductionProviderMode" as const })
    )
  )
}

export type ProviderRuntimeMode = Schema.Schema.Type<
  typeof ProviderRuntimeModeSchema
>
