import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnrichmentProviderInput,
  EnrichmentProviderOutput,
} from "../../../../domain/enrichment.js"
import { providerFailure, type ProviderFailure } from "./failures.js"
import type { EnrichmentPayloadSchema } from "./schema.js"

export const validateEnrichment = (
  payload: typeof EnrichmentPayloadSchema.Type,
  usage: Readonly<{
    readonly inputTokens: Readonly<{ readonly total?: number }>
    readonly outputTokens: Readonly<{ readonly total?: number }>
  }>,
  input: EnrichmentProviderInput
): Effect.Effect<EnrichmentProviderOutput, ProviderFailure> => {
  if (payload.tags.some((tag) => !input.tagVocabulary.includes(tag))) {
    return Effect.fail(providerFailure({ _tag: "Malformed" }))
  }
  return Effect.succeed(
    deepFreeze({
      ...payload,
      tokensIn: usage.inputTokens.total ?? 0,
      tokensOut: usage.outputTokens.total ?? 0,
    })
  )
}
