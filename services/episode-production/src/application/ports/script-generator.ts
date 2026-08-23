import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type { ProviderFailure } from "../../domain/provider-reliability.js"
import type { ProviderRetryExhausted } from "../retry-provider.js"

export type ScriptSource = DeepReadonly<{
  readonly title: string
  readonly url: string
  readonly markdown: string
}>

export type ScriptGenerationRequest = DeepReadonly<{
  readonly sources: readonly ScriptSource[]
  readonly interestProfile?: Readonly<{
    readonly include: string
    readonly exclude: string
  }>
  readonly signal?: AbortSignal
}>

export type GeneratedScript = DeepReadonly<{
  readonly title: string
  readonly script: string
  readonly sourceIndexes: readonly number[]
}>

export type ScriptGenerationFailure =
  | ProviderFailure
  | Readonly<{ readonly _tag: "QualityRejected" }>
  | ProviderRetryExhausted<ProviderFailure>

export type ScriptGenerator = DeepReadonly<{
  readonly generate: (
    request: ScriptGenerationRequest
  ) => Effect.Effect<GeneratedScript, ScriptGenerationFailure>
}>
