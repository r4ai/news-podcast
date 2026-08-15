import { deepFreeze } from "@news-podcast/kernel"

import type { EnrichmentProviderError } from "../../application/enrichment.js"
import type { OpenAiEnrichmentProviderConfig } from "./config.js"

/**
 * プロバイダ内部の失敗の語彙と、それを再試行判断・公開エラーへ翻訳する規則。
 * 上流のメッセージや本文は外へ出さない。
 */

export type ProviderFailure = Readonly<
  | {
      readonly _tag: "Http"
      readonly status: number
      readonly retryAfter?: string
    }
  | { readonly _tag: "Timeout" }
  | { readonly _tag: "Transport" }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "Refusal" }
>

export const providerFailure = (value: ProviderFailure): ProviderFailure =>
  Object.freeze(value)

export const applicationFailure = (
  reason: EnrichmentProviderError["reason"],
  message: string
): EnrichmentProviderError =>
  deepFreeze({ _tag: "EnrichmentProviderFailed", reason, message })

export const isProviderFailure = (value: unknown): value is ProviderFailure =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  ["Http", "Timeout", "Transport", "Malformed", "Refusal"].includes(
    String((value as { _tag: unknown })._tag)
  )

/** 秒数かHTTP-dateの形をした短い値だけを、再試行の手掛かりとして受け取る。 */
export const readRetryAfter = (response: Response): string | undefined => {
  const value = response.headers.get("retry-after")?.trim()
  if (!value || value.length > 64) return undefined
  return /^\d+$/.test(value) ||
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value
    )
    ? value
    : undefined
}

/**
 * 次の試行までの待ち時間。上流が指示した待ちを優先し、
 * 無ければ指数バックオフ。いずれも上限を超えるなら再試行しない。
 */
export const retryDelay = (
  failure: ProviderFailure,
  attempt: number,
  nowMillis: number,
  config: OpenAiEnrichmentProviderConfig
): number | undefined => {
  const retryable =
    failure._tag === "Timeout" ||
    (failure._tag === "Http" &&
      (failure.status === 429 ||
        (failure.status >= 500 && failure.status <= 599)))
  if (!retryable || attempt >= config.maximumAttempts) return undefined
  if (failure._tag === "Http" && failure.retryAfter) {
    const delay = /^\d+$/.test(failure.retryAfter)
      ? Number(failure.retryAfter) * 1_000
      : Math.max(0, Date.parse(failure.retryAfter) - nowMillis)
    return Number.isSafeInteger(delay) && delay <= config.maximumDelayMillis
      ? delay
      : undefined
  }
  return Math.min(
    config.baseDelayMillis * 2 ** (attempt - 1),
    config.maximumDelayMillis
  )
}

export const publicFailure = (
  failure: ProviderFailure
): EnrichmentProviderError => {
  if (failure._tag === "Timeout") {
    return applicationFailure(
      "Retryable",
      "enrichment provider request timed out"
    )
  }
  if (failure._tag === "Http" && failure.status === 429) {
    return applicationFailure("RateLimited", "enrichment provider rate limited")
  }
  if (
    failure._tag === "Http" &&
    failure.status >= 500 &&
    failure.status <= 599
  ) {
    return applicationFailure("Retryable", "enrichment provider unavailable")
  }
  if (failure._tag === "Http") {
    return applicationFailure(
      "Permanent",
      "enrichment provider rejected request"
    )
  }
  if (failure._tag === "Transport") {
    return applicationFailure(
      "Permanent",
      "enrichment provider transport failed"
    )
  }
  if (failure._tag === "Refusal") {
    return applicationFailure(
      "Permanent",
      "enrichment provider refused request"
    )
  }
  return applicationFailure("Permanent", "invalid enrichment provider response")
}
