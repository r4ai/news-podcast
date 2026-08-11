import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { createTelemetryRateLimiter } from "./rate-limit.js"

export const telemetryRoute = createRoute({
  method: "post",
  path: "/v1/telemetry/{signal}",
  tags: ["System"],
  operationId: "ingestBrowserTelemetry",
  description: "Forward authenticated same-origin browser OTLP telemetry.",
  request: {
    params: z.object({ signal: z.enum(["logs", "metrics", "traces"]) }),
    body: {
      required: true,
      content: {
        "application/x-protobuf": {
          schema: z.any().openapi({ type: "string", format: "binary" }),
        },
        "application/json": { schema: z.any() },
      },
    },
  },
  responses: {
    204: { description: "Accepted" },
    401: problemContent("Unauthorized"),
    403: problemContent("Forbidden"),
    413: problemContent("Payload too large"),
    415: problemContent("Unsupported media type"),
    429: problemContent("Rate limited"),
    503: problemContent("Unavailable"),
  },
})

/**
 * ブラウザ側OTLPをコレクタへ転送する。同一オリジンのみ許可し、
 * サイズ上限（256KB）とowner毎のレート制限で収集エンドポイントを保護する。
 */
export const registerIngestTelemetry: RouteRegistrar = (app, dependencies) => {
  // レート制限の状態はcreateApp() 呼び出し毎（=このregistrarの呼び出し毎）に独立させる。
  const consumeTelemetryRequest = createTelemetryRateLimiter()

  app.openapi(telemetryRoute, async (context) => {
    if (!dependencies.forwardTelemetry) return unavailable(context)
    const origin = context.req.header("Origin")
    if (!origin || origin !== dependencies.telemetryOrigin) {
      return context.json(problem(403, "forbidden", "Forbidden"), 403)
    }
    const contentType = context.req.header("Content-Type")?.split(";", 1)[0]
    if (
      contentType !== "application/x-protobuf" &&
      contentType !== "application/json"
    ) {
      return context.json(
        problem(415, "unsupported-media-type", "Unsupported media type"),
        415
      )
    }
    const contentLength = Number(context.req.header("Content-Length") ?? "0")
    if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
      return context.json(
        problem(413, "payload-too-large", "Payload too large"),
        413
      )
    }
    if (!consumeTelemetryRequest(context.get("ownerId"))) {
      return context.json(problem(429, "rate-limited", "Rate limited"), 429)
    }
    const body = new Uint8Array(await context.req.arrayBuffer())
    if (body.byteLength > 256 * 1024) {
      return context.json(
        problem(413, "payload-too-large", "Payload too large"),
        413
      )
    }
    try {
      await dependencies.forwardTelemetry(
        context.req.valid("param").signal,
        body,
        contentType
      )
      return context.body(null, 204)
    } catch {
      return unavailable(context)
    }
  })
}
