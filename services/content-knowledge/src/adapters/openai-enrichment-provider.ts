import { deepFreeze, parse } from "@news-podcast/kernel"
import { Clock, Effect } from "effect"

import type {
  EnrichmentProvider,
  EnrichmentProviderError,
} from "../application/enrichment.js"
import {
  EnrichmentProviderInputSchema,
  type EnrichmentProviderOutput,
} from "../domain/enrichment.js"
import type {
  OpenAiEnrichmentProviderConfig,
  OpenAiEnrichmentProviderDependencies,
} from "./openai-enrichment/config.js"
import {
  applicationFailure,
  publicFailure,
  retryDelay,
} from "./openai-enrichment/failures.js"
import { fetchResponse } from "./openai-enrichment/request.js"
import { interpret } from "./openai-enrichment/response.js"

/**
 * AI補完プロバイダの合成点。送信 → 解釈 → 再試行の輪だけをここに置き、
 * 個々の判断は`./openai-enrichment/`配下に委ねる。
 */

export type {
  OpenAiEnrichmentProviderConfig,
  OpenAiEnrichmentProviderDependencies,
}

const parseInput = parse(EnrichmentProviderInputSchema)

export const makeOpenAiEnrichmentProvider = (
  config: OpenAiEnrichmentProviderConfig,
  dependencies: OpenAiEnrichmentProviderDependencies = {}
): EnrichmentProvider => {
  const fetcher = dependencies.fetcher ?? fetch
  const nowMillis = dependencies.nowMillis ?? (() => Clock.currentTimeMillis)
  const sleep =
    dependencies.sleep ?? ((milliseconds) => Effect.sleep(milliseconds))

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
            fetchResponse(config, input, fetcher).pipe(
              Effect.flatMap((response) => interpret(response, input)),
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
