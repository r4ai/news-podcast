import { deepFreeze } from "@news-podcast/kernel"
import { Duration } from "effect"
import type { AiError } from "effect/unstable/ai"

export type AiRuntimeFailure =
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

const httpStatus = (error: AiError.AiError): number | undefined =>
  "http" in error.reason ? error.reason.http?.response?.status : undefined

const retryAfter = (error: AiError.AiError): string | undefined => {
  if (error.retryAfter === undefined) return undefined
  return String(
    Math.max(0, Math.ceil(Duration.toMillis(error.retryAfter) / 1_000))
  )
}

/** Maps Effect AI's semantic errors without retaining provider bodies or credentials. */
export const toAiRuntimeFailure = (
  error: AiError.AiError
): AiRuntimeFailure => {
  switch (error.reason._tag) {
    case "RateLimitError":
      return deepFreeze({
        _tag: "HttpFailure",
        status: 429,
        ...(retryAfter(error) === undefined
          ? {}
          : { retryAfter: retryAfter(error) }),
      })
    case "QuotaExhaustedError":
      return deepFreeze({ _tag: "HttpFailure", status: 429 })
    case "AuthenticationError":
      return deepFreeze({
        _tag: "HttpFailure",
        status: httpStatus(error) ?? 401,
      })
    case "InvalidRequestError":
      return deepFreeze({
        _tag: "HttpFailure",
        status: httpStatus(error) ?? 400,
      })
    case "InternalProviderError":
      return deepFreeze({
        _tag: "HttpFailure",
        status: httpStatus(error) ?? 500,
      })
    case "ContentPolicyError":
      return deepFreeze({ _tag: "Refusal" })
    case "NetworkError":
      return deepFreeze(
        error.reason.description === "response_too_large"
          ? { _tag: "MalformedResponse" }
          : { _tag: "TransportFailure" }
      )
    case "InvalidOutputError":
    case "StructuredOutputError":
    case "UnsupportedSchemaError":
    case "InvalidToolResultError":
    case "ToolParameterValidationError":
    case "ToolResultEncodingError":
      return deepFreeze({ _tag: "MalformedResponse" })
    default:
      return deepFreeze({
        _tag: "HttpFailure",
        status: httpStatus(error) ?? (error.isRetryable ? 500 : 400),
      })
  }
}
