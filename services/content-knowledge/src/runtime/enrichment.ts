import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnrichmentProvider,
  EnrichmentProviderError,
  EnrichmentSource,
} from "../application/enrichment.js"
import type { MarkdownObjectReader } from "../application/ports/article-catalog.js"

const providerUnavailable = (): EnrichmentProviderError =>
  deepFreeze({
    _tag: "EnrichmentProviderFailed",
    reason: "Permanent",
    message: "enrichment provider unavailable",
  })

/** Fail-closed default: claimed work is durably failed, never reported successful. */
export const unavailableEnrichmentProvider: EnrichmentProvider = deepFreeze({
  enrich: () => Effect.fail(providerUnavailable()),
})

export const makeEnrichmentSource = (
  reader: MarkdownObjectReader
): EnrichmentSource =>
  deepFreeze({
    read: (key, maximumCharacters) =>
      reader.read(key).pipe(
        Effect.mapError((failure) =>
          deepFreeze({
            _tag: "EnrichmentSourceFailed" as const,
            reason:
              failure.reason === "NotFound"
                ? ("NotFound" as const)
                : failure.reason === "ResourceLimit"
                  ? ("ResourceLimit" as const)
                  : ("Unavailable" as const),
          })
        ),
        Effect.filterOrFail(
          (markdown) => markdown.length <= maximumCharacters,
          () =>
            deepFreeze({
              _tag: "EnrichmentSourceFailed" as const,
              reason: "ResourceLimit" as const,
            })
        )
      ),
  })
