import type { Effect } from "effect"

/**
 * OpenAI互換の補完プロバイダが依存する設定と、差し替え可能な実行環境。
 */

export type OpenAiEnrichmentProviderConfig = Readonly<{
  readonly endpoint: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly maximumAttempts: number
  readonly baseDelayMillis: number
  readonly maximumDelayMillis: number
}>

export type OpenAiEnrichmentProviderDependencies = Readonly<{
  readonly fetcher?: typeof fetch
  readonly nowMillis?: () => Effect.Effect<number>
  readonly sleep?: (milliseconds: number) => Effect.Effect<void>
}>
