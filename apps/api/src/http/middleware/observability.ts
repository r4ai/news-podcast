import { trace } from "@opentelemetry/api"
import type { MiddlewareHandler } from "hono"
import type { Observability } from "@news-podcast/observability"

import type { Variables } from "../context.js"

/**
 * /v1/* の各リクエストに、自動計装（instrumentation-http）が生成した
 * server span へ http.route を付与し、api.request ログと
 * http.server.error / http.server.duration を記録する。
 * /v1/telemetry/* はテレメトリ収集自体の計装ループを避けるため対象外。
 */
export function observabilityMiddleware(
  observability: Observability
): MiddlewareHandler<{ Variables: Variables }> {
  return async (context, next) => {
    if (context.req.path.startsWith("/v1/telemetry/")) return next()
    const startedAt = performance.now()
    // 自動計装（instrumentation-http）が生成したserver spanの欠落を開発時に検出する。
    observability.assertActiveSpan("http.request")
    try {
      await next()
    } finally {
      // routePathはルーティング完了後のnext()後に確定する（例: /v1/feeds）。
      const route = context.req.routePath
      const span = trace.getActiveSpan()
      if (span) span.setAttribute("http.route", route)
      const status = context.res.status
      observability.log({
        name: "api.request",
        attributes: {
          "http.request.method": context.req.method,
          "http.response.status_code": status,
          "http.route": route,
        },
        level: status >= 500 ? "error" : "info",
      })
      if (status >= 500) {
        observability.count("http.server.error", 1, {
          "http.request.method": context.req.method,
          "http.response.status_code": status,
          "http.route": route,
        })
      }
      observability.measure(
        "http.server.duration",
        performance.now() - startedAt
      )
    }
  }
}
