import type { ProviderRetryRuntime } from "../../../application/retry-provider.js"
import type { ProviderRetryPolicy } from "../../../domain/provider-reliability.js"

/**
 * VOICEVOXアダプタが依存する設定と差し替え可能な実行環境。
 */

export type VoicevoxSpeechSynthesizerConfig = Readonly<{
  readonly baseUrl: URL
  readonly characterName: string
  readonly styleName?: string
  readonly requestTimeoutMillis: number
  readonly maximumAudioBytes: number
  readonly maximumTextCharactersPerRequest: number
  readonly retryPolicy: ProviderRetryPolicy
}>

export type VoicevoxSpeechSynthesizerDependencies = Readonly<{
  readonly fetcher?: typeof fetch
  readonly retryRuntime?: ProviderRetryRuntime
}>
