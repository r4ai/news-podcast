import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api"

import { normalizedError, sanitizeAttributes } from "./privacy.js"

export interface TracedFetchConfig {
  readonly provider: string
  readonly operation: string | ((url: URL) => string)
  readonly fetcher?: typeof fetch
}

interface TracedFetchDependencies {
  readonly tracer?: Tracer
}

export function createTracedFetch(
  config: TracedFetchConfig,
  dependencies: TracedFetchDependencies = {}
): typeof fetch {
  const fetcher = config.fetcher ?? fetch
  const tracer =
    dependencies.tracer ?? trace.getTracer("@news-podcast/observability-client")

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const operation =
      typeof config.operation === "function"
        ? config.operation(url)
        : config.operation
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase()
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    headers.delete("traceparent")
    headers.delete("tracestate")
    headers.delete("baggage")

    return tracer.startActiveSpan(
      `provider.${config.provider}.${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: sanitizeAttributes({
          "provider.name": config.provider,
          "provider.operation": operation,
          "http.request.method": method,
        }),
      },
      async (span) => {
        try {
          const response = await fetcher(input, { ...init, headers })
          span.setAttribute("http.response.status_code", response.status)
          span.setAttribute(
            "provider.outcome",
            response.ok ? "succeeded" : "error"
          )
          if (!response.ok) {
            span.setStatus({ code: SpanStatusCode.ERROR })
          }
          return response
        } catch (error) {
          const normalized = normalizedError(error)
          span.recordException(new Error(normalized.type))
          span.setAttribute("error.type", normalized.type)
          span.setAttribute("provider.outcome", "error")
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      }
    )
  }
}
