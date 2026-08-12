import type { Effect } from "effect"

import type { ProviderRetryExhausted } from "./retry-provider.js"
import type { ProviderFailure } from "../domain/provider-reliability.js"

export type SpeechSynthesisRequest = Readonly<{
  readonly text: string
  readonly signal?: AbortSignal
}>

export type SpeechSynthesisFailure =
  | ProviderFailure
  | ProviderRetryExhausted<ProviderFailure>

/** Transfers ownership of a fresh WAV byte array to the caller. */
export type SpeechSynthesizer = Readonly<{
  readonly synthesize: (
    request: SpeechSynthesisRequest
  ) => Effect.Effect<Uint8Array, SpeechSynthesisFailure>
}>
