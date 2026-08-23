import type { Layer } from "effect"
import type { LanguageModel } from "effect/unstable/ai"

/**
 * OpenAI互換の補完プロバイダが依存する設定と、差し替え可能な実行環境。
 */

export type OpenAiEnrichmentProviderConfig = Readonly<{
  readonly apiUrl: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
}>

export type OpenAiEnrichmentProviderDependencies = Readonly<{
  readonly languageModelLayer?: Layer.Layer<LanguageModel.LanguageModel>
  readonly fetcher?: typeof fetch
}>
