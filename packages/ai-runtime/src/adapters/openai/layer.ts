import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { LanguageModel } from "effect/unstable/ai"

import { makeBoundedFetch } from "../http/bounded-fetch.js"

export type OpenAiRuntimeConfig = Readonly<{
  readonly apiKey: string
  readonly apiUrl: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly maximumResponseBytes: number
  readonly maximumOutputTokens: number
}>

export type OpenAiRuntimeDependencies = Readonly<{
  readonly fetcher?: typeof fetch
}>

/** Provides the official Effect AI OpenAI client and language model as one redacted layer. */
export const makeOpenAiLanguageModelLayer = (
  config: OpenAiRuntimeConfig,
  dependencies: OpenAiRuntimeDependencies = {}
): Layer.Layer<LanguageModel.LanguageModel> => {
  const fetchLayer = Layer.succeed(
    FetchHttpClient.Fetch,
    makeBoundedFetch({
      maximumResponseBytes: config.maximumResponseBytes,
      ...(dependencies.fetcher === undefined
        ? {}
        : { fetcher: dependencies.fetcher }),
    })
  )
  const httpLayer = FetchHttpClient.layer.pipe(Layer.provide(fetchLayer))
  const clientLayer = OpenAiClient.layer({
    apiKey: Redacted.make(config.apiKey),
    apiUrl: config.apiUrl,
  }).pipe(Layer.provide(httpLayer))
  return OpenAiLanguageModel.layer({
    model: config.model,
    config: {
      max_output_tokens: config.maximumOutputTokens,
      strictJsonSchema: true,
      store: false,
    },
  }).pipe(Layer.provide(clientLayer))
}
