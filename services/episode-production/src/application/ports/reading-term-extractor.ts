import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type {
  ReadingAccentType,
  ReadingPronunciation,
  ReadingSurface,
} from "../../domain/reading-dictionary.js"
import type { ProviderFailure } from "../../domain/provider-reliability.js"
import type { ProviderRetryExhausted } from "../retry-provider.js"

export type ReadingTermCandidate = DeepReadonly<{
  readonly surface: ReadingSurface
  readonly reading: ReadingPronunciation
  readonly accentType: ReadingAccentType
}>

export type ReadingTermExtractionFailure =
  | ProviderFailure
  | ProviderRetryExhausted<ProviderFailure>

export type ReadingTermExtractor = DeepReadonly<{
  readonly extract: (input: {
    readonly script: string
    readonly signal?: AbortSignal
  }) => Effect.Effect<
    readonly ReadingTermCandidate[],
    ReadingTermExtractionFailure
  >
}>
