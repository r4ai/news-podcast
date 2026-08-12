import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type { ProviderFailure } from "../domain/provider-reliability.js"
import type { ProviderRetryExhausted } from "./retry-provider.js"

export type ScriptSource = DeepReadonly<{
  readonly title: string
  readonly url: string
  readonly markdown: string
}>

export type ScriptGenerationRequest = DeepReadonly<{
  readonly sources: readonly ScriptSource[]
  readonly signal?: AbortSignal
}>

export type GeneratedScript = DeepReadonly<{
  readonly title: string
  readonly script: string
  readonly sourceUrls: readonly string[]
}>

export type ScriptGenerationFailure =
  | ProviderFailure
  | ProviderRetryExhausted<ProviderFailure>

export type ScriptGenerator = DeepReadonly<{
  readonly generate: (
    request: ScriptGenerationRequest
  ) => Effect.Effect<GeneratedScript, ScriptGenerationFailure>
}>
