import {
  applyAiRuntimePolicy,
  makeOpenAiLanguageModelLayer,
  type AiRuntimeFailure,
} from "@news-podcast/ai-runtime"
import { deepFreeze, parse } from "@news-podcast/kernel"
import { Clock, Effect } from "effect"
import { LanguageModel } from "effect/unstable/ai"

import type {
  EnrichmentProvider,
  EnrichmentProviderError,
} from "../../../../application/enrichment.js"
import {
  EnrichmentProviderInputSchema,
  type EnrichmentProviderOutput,
} from "../../../../domain/enrichment.js"
import type {
  OpenAiEnrichmentProviderConfig,
  OpenAiEnrichmentProviderDependencies,
} from "./config.js"
import { applicationFailure, publicFailure, retryDelay } from "./failures.js"
import { enrichmentPrompt } from "./prompt.js"
import { EnrichmentPayloadSchema } from "./schema.js"
import { validateEnrichment } from "./validation.js"

/**
 * AI補完プロバイダの合成点。送信 → 解釈 → 再試行の輪だけをここに置き、
 * 個々の判断は`./openai-enrichment/`配下に委ねる。
 */

export type {
  OpenAiEnrichmentProviderConfig,
  OpenAiEnrichmentProviderDependencies,
}

const parseInput = parse(EnrichmentProviderInputSchema)
const MAXIMUM_RESPONSE_BYTES = 1_048_576
const MAXIMUM_OUTPUT_TOKENS = 2_048

const providerFailureFromAi = (
  failure: AiRuntimeFailure
): import("./failures.js").ProviderFailure => {
  switch (failure._tag) {
    case "HttpFailure":
      return Object.freeze({
        _tag: "Http",
        status: failure.status,
        ...(failure.retryAfter === undefined
          ? {}
          : { retryAfter: failure.retryAfter }),
      })
    case "Timeout":
      return Object.freeze({ _tag: "Timeout" })
    case "TransportFailure":
    case "Canceled":
      return Object.freeze({ _tag: "Transport" })
    case "Refusal":
      return Object.freeze({ _tag: "Refusal" })
    default:
      return Object.freeze({ _tag: "Malformed" })
  }
}

export const makeOpenAiEnrichmentProvider = (
  config: OpenAiEnrichmentProviderConfig,
  dependencies: OpenAiEnrichmentProviderDependencies = {}
): EnrichmentProvider => {
  const nowMillis = dependencies.nowMillis ?? (() => Clock.currentTimeMillis)
  const sleep =
    dependencies.sleep ?? ((milliseconds) => Effect.sleep(milliseconds))
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
    enrich: (unknownInput) =>
      parseInput(unknownInput).pipe(
        Effect.mapError(() =>
          applicationFailure("Permanent", "invalid enrichment provider input")
        ),
        Effect.flatMap((input) => {
          const attempt = (
            number: number
          ): Effect.Effect<EnrichmentProviderOutput, EnrichmentProviderError> =>
            applyAiRuntimePolicy(
              LanguageModel.generateObject({
                objectName: "article_enrichment_v1",
                prompt: enrichmentPrompt(input),
                schema: EnrichmentPayloadSchema,
              }).pipe(Effect.provide(languageModelLayer)),
              { requestTimeoutMillis: config.requestTimeoutMillis }
            ).pipe(
              Effect.mapError(providerFailureFromAi),
              Effect.flatMap((response) =>
                validateEnrichment(response.value, response.usage, input)
              ),
              Effect.matchEffect({
                onFailure: (failure) =>
                  nowMillis().pipe(
                    Effect.flatMap((now) => {
                      const delay = retryDelay(failure, number, now, config)
                      return delay === undefined
                        ? Effect.fail(publicFailure(failure))
                        : sleep(delay).pipe(Effect.andThen(attempt(number + 1)))
                    })
                  ),
                onSuccess: Effect.succeed,
              })
            )
          return attempt(1)
        })
      ),
  })
}
