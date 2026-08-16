import {
  applyAiRuntimePolicy,
  makeOpenAiLanguageModelLayer,
  type AiRuntimeFailure,
} from "@news-podcast/ai-runtime"
import { deepFreeze } from "@news-podcast/kernel"
import { Effect, type Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"

import {
  retryProvider,
  type ProviderRetryRuntime,
} from "../../../application/retry-provider.js"
import type { ScriptGenerator } from "../../../application/ports/script-generator.js"
import type {
  ProviderFailure,
  ProviderRetryPolicy,
} from "../../../domain/provider-reliability.js"
import { scriptPrompt } from "./prompt.js"
import { ScriptPayloadSchema } from "./schema.js"
import { validateGeneratedScript } from "./validation.js"

const MAXIMUM_RESPONSE_BYTES = 1_048_576
const MAXIMUM_OUTPUT_TOKENS = 4_096

export type OpenAiScriptGeneratorConfig = Readonly<{
  readonly apiUrl: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly retryPolicy: ProviderRetryPolicy
}>

export type OpenAiScriptGeneratorDependencies = Readonly<{
  readonly languageModelLayer?: Layer.Layer<LanguageModel.LanguageModel>
  readonly fetcher?: typeof fetch
  readonly retryRuntime?: ProviderRetryRuntime
}>

const providerFailure = (failure: AiRuntimeFailure): ProviderFailure =>
  deepFreeze(failure)

export const makeOpenAiScriptGenerator = (
  config: OpenAiScriptGeneratorConfig,
  dependencies: OpenAiScriptGeneratorDependencies = {}
): ScriptGenerator => {
  const languageModelLayer =
    dependencies.languageModelLayer ??
    makeOpenAiLanguageModelLayer(
      {
        apiKey: config.apiKey,
        apiUrl: config.apiUrl.toString(),
        model: config.model,
        requestTimeoutMillis: config.requestTimeoutMillis,
        maximumResponseBytes: MAXIMUM_RESPONSE_BYTES,
        maximumOutputTokens: MAXIMUM_OUTPUT_TOKENS,
      },
      dependencies.fetcher === undefined
        ? {}
        : { fetcher: dependencies.fetcher }
    )
  return deepFreeze({
    generate: (request) => {
      const operation = () =>
        applyAiRuntimePolicy(
          LanguageModel.generateObject({
            objectName: "episode_script_v1",
            prompt: scriptPrompt(request),
            schema: ScriptPayloadSchema,
          }).pipe(Effect.provide(languageModelLayer)),
          {
            requestTimeoutMillis: config.requestTimeoutMillis,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          }
        ).pipe(
          Effect.mapError(providerFailure),
          Effect.flatMap((response) =>
            validateGeneratedScript(response.value, request)
          )
        )
      return dependencies.retryRuntime === undefined
        ? retryProvider(operation, config.retryPolicy)
        : retryProvider(
            operation,
            config.retryPolicy,
            dependencies.retryRuntime
          )
    },
  })
}
