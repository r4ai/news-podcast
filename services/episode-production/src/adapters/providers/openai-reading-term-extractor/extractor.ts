import {
  applyAiRuntimePolicy,
  makeOpenAiLanguageModelLayer,
  type AiRuntimeFailure,
} from "@news-podcast/ai-runtime"
import { deepFreeze } from "@news-podcast/kernel"
import { Effect, type Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"

import type { ReadingTermExtractor } from "../../../application/ports/reading-term-extractor.js"
import {
  retryProvider,
  type ProviderRetryRuntime,
} from "../../../application/retry-provider.js"
import type {
  ProviderFailure,
  ProviderRetryPolicy,
} from "../../../domain/provider-reliability.js"
import { readingTermPrompt } from "./prompt.js"
import { ReadingTermsPayloadSchema } from "./schema.js"
import { validateReadingTerms } from "./validation.js"

const MAXIMUM_RESPONSE_BYTES = 262_144
const MAXIMUM_OUTPUT_TOKENS = 2_048

export type OpenAiReadingTermExtractorConfig = Readonly<{
  readonly apiUrl: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly retryPolicy: ProviderRetryPolicy
}>

export type OpenAiReadingTermExtractorDependencies = Readonly<{
  readonly languageModelLayer?: Layer.Layer<LanguageModel.LanguageModel>
  readonly fetcher?: typeof fetch
  readonly retryRuntime?: ProviderRetryRuntime
}>

const providerFailure = (failure: AiRuntimeFailure): ProviderFailure =>
  deepFreeze(failure)

export const makeOpenAiReadingTermExtractor = (
  config: OpenAiReadingTermExtractorConfig,
  dependencies: OpenAiReadingTermExtractorDependencies = {}
): ReadingTermExtractor => {
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
    extract: (input) => {
      const operation = () =>
        applyAiRuntimePolicy(
          LanguageModel.generateObject({
            objectName: "reading_dictionary_terms_v1",
            prompt: readingTermPrompt(input.script),
            schema: ReadingTermsPayloadSchema,
          }).pipe(Effect.provide(languageModelLayer)),
          {
            requestTimeoutMillis: config.requestTimeoutMillis,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          }
        ).pipe(
          Effect.mapError(providerFailure),
          Effect.map((response) =>
            validateReadingTerms(response.value, input.script)
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

export const makeNoopReadingTermExtractor = (): ReadingTermExtractor =>
  deepFreeze({ extract: () => Effect.succeed([]) })
