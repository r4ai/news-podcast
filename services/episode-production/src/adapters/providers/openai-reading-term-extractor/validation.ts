import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

import type { ReadingTermCandidate } from "../../../application/ports/reading-term-extractor.js"
import {
  ReadingAccentTypeSchema,
  ReadingPronunciationSchema,
  ReadingSurfaceSchema,
} from "../../../domain/reading-dictionary.js"
import type { ReadingTermsPayloadSchema } from "./schema.js"

/** Discards only hallucinated terms so one bad candidate cannot poison valid terms. */
export const validateReadingTerms = (
  payload: typeof ReadingTermsPayloadSchema.Type,
  script: string
): readonly ReadingTermCandidate[] => {
  const normalizedScript = script.normalize("NFKC").toLocaleLowerCase("ja")
  const seen = new Set<string>()
  const candidates: ReadingTermCandidate[] = []
  for (const term of payload.terms) {
    try {
      const surface = Schema.decodeUnknownSync(ReadingSurfaceSchema)(
        term.surface
      )
      const reading = Schema.decodeUnknownSync(ReadingPronunciationSchema)(
        term.reading
      )
      const accentType = Schema.decodeUnknownSync(ReadingAccentTypeSchema)(
        term.accent_type
      )
      const key = surface.normalize("NFKC").toLocaleLowerCase("ja")
      if (!normalizedScript.includes(key) || seen.has(key)) continue
      seen.add(key)
      candidates.push(deepFreeze({ surface, reading, accentType }))
    } catch {
      // Domain-invalid model candidates are intentionally ignored.
    }
  }
  return deepFreeze(candidates)
}
