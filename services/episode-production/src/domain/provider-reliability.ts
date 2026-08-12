export type ProviderFailure =
  | Readonly<{
      readonly _tag: "HttpFailure"
      readonly status: number
      readonly retryAfter?: string
    }>
  | Readonly<{ readonly _tag: "Timeout" }>
  | Readonly<{ readonly _tag: "TransportFailure" }>
  | Readonly<{ readonly _tag: "Incomplete" }>
  | Readonly<{ readonly _tag: "MalformedResponse" }>
  | Readonly<{ readonly _tag: "Refusal" }>
  | Readonly<{ readonly _tag: "Canceled" }>

export type ProviderFailureClassification =
  | Readonly<{
      readonly retryable: true
      readonly reason: "RateLimited" | "Unavailable" | "Timeout" | "Incomplete"
      readonly retryAfterMillis?: number
    }>
  | Readonly<{
      readonly retryable: false
      readonly reason:
        | "ClientError"
        | "Canceled"
        | "MalformedResponse"
        | "Refusal"
        | "UnexpectedStatus"
    }>

export type ProviderRetryPolicy = Readonly<{
  /** Total provider calls, including the first call. */
  readonly maximumAttempts: number
  /** Wall-clock budget measured from immediately before the first call. */
  readonly maximumElapsedMillis: number
  readonly baseDelayMillis: number
  /** A Retry-After value above this limit is not shortened; retrying stops. */
  readonly maximumDelayMillis: number
}>

export type ProviderRetryDecision =
  | Readonly<{ readonly _tag: "Retry"; readonly delayMillis: number }>
  | Readonly<{
      readonly _tag: "Stop"
      readonly reason:
        | "NonRetryable"
        | "AttemptLimit"
        | "ElapsedTimeLimit"
        | "RetryDelayLimit"
    }>

/** Parses both Retry-After forms using the supplied clock value. */
export const parseRetryAfterMillis = (
  value: string | undefined,
  nowMillis: number
): number | undefined => {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    const millis = seconds * 1_000
    return Number.isSafeInteger(millis) ? millis : undefined
  }
  // Retry-After permits IMF-fixdate, not Date.parse's permissive legacy forms.
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      normalized
    )
  ) {
    return undefined
  }
  const atMillis = Date.parse(normalized)
  if (!Number.isFinite(atMillis)) return undefined
  return Math.max(0, atMillis - nowMillis)
}

export const classifyProviderFailure = (
  failure: ProviderFailure,
  nowMillis: number
): ProviderFailureClassification => {
  switch (failure._tag) {
    case "Timeout":
      return Object.freeze({ retryable: true, reason: "Timeout" })
    case "TransportFailure":
      return Object.freeze({ retryable: true, reason: "Unavailable" })
    case "Incomplete":
      return Object.freeze({ retryable: true, reason: "Incomplete" })
    case "MalformedResponse":
      return Object.freeze({
        retryable: false,
        reason: "MalformedResponse",
      })
    case "Refusal":
      return Object.freeze({ retryable: false, reason: "Refusal" })
    case "Canceled":
      return Object.freeze({ retryable: false, reason: "Canceled" })
    case "HttpFailure": {
      if (failure.status === 429) {
        const retryAfterMillis = parseRetryAfterMillis(
          failure.retryAfter,
          nowMillis
        )
        return Object.freeze({
          retryable: true,
          reason: "RateLimited",
          ...(retryAfterMillis === undefined ? {} : { retryAfterMillis }),
        })
      }
      if (failure.status >= 500 && failure.status <= 599) {
        const retryAfterMillis = parseRetryAfterMillis(
          failure.retryAfter,
          nowMillis
        )
        return Object.freeze({
          retryable: true,
          reason: "Unavailable",
          ...(retryAfterMillis === undefined ? {} : { retryAfterMillis }),
        })
      }
      if (failure.status >= 400 && failure.status <= 499) {
        return Object.freeze({ retryable: false, reason: "ClientError" })
      }
      return Object.freeze({ retryable: false, reason: "UnexpectedStatus" })
    }
  }
}

export const decideProviderRetry = (input: {
  readonly failure: ProviderFailure
  readonly completedAttempts: number
  readonly startedAtMillis: number
  readonly nowMillis: number
  readonly policy: ProviderRetryPolicy
}): ProviderRetryDecision => {
  const classification = classifyProviderFailure(input.failure, input.nowMillis)
  if (!classification.retryable) {
    return Object.freeze({ _tag: "Stop", reason: "NonRetryable" })
  }
  if (input.completedAttempts >= input.policy.maximumAttempts) {
    return Object.freeze({ _tag: "Stop", reason: "AttemptLimit" })
  }

  const retryAfterMillis = classification.retryAfterMillis
  if (
    retryAfterMillis !== undefined &&
    retryAfterMillis > input.policy.maximumDelayMillis
  ) {
    return Object.freeze({ _tag: "Stop", reason: "RetryDelayLimit" })
  }
  const exponentialDelay = Math.min(
    input.policy.baseDelayMillis * 2 ** (input.completedAttempts - 1),
    input.policy.maximumDelayMillis
  )
  const delayMillis = retryAfterMillis ?? exponentialDelay
  const elapsedMillis = Math.max(0, input.nowMillis - input.startedAtMillis)
  if (elapsedMillis + delayMillis >= input.policy.maximumElapsedMillis) {
    return Object.freeze({ _tag: "Stop", reason: "ElapsedTimeLimit" })
  }
  return Object.freeze({ _tag: "Retry", delayMillis })
}
