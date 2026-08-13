import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import { parseNodeGatewayConfig, type NodeGatewayRuntimeError } from "./node.js"

const configFailure = (): NodeGatewayRuntimeError =>
  deepFreeze({
    _tag: "GatewayRuntimeFailed" as const,
    component: "Config" as const,
  })

const parseBoolean = (
  value: string | undefined,
  fallback: boolean
): Effect.Effect<boolean, NodeGatewayRuntimeError> => {
  if (value === undefined || value.trim() === "")
    return Effect.succeed(fallback)
  if (value === "true") return Effect.succeed(true)
  if (value === "false") return Effect.succeed(false)
  return Effect.fail(configFailure())
}

export const readGatewayConfig = (
  env: Readonly<Record<string, string | undefined>>
) =>
  Effect.gen(function* () {
    const development = yield* parseBoolean(env.DEV_AUTH_ENABLED, false)
    const servers = (env.NATS_SERVERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    return yield* parseNodeGatewayConfig({
      hostname: env.GATEWAY_HOST?.trim() || "0.0.0.0",
      port: Number(env.GATEWAY_PORT ?? "4001"),
      natsServers: servers,
      requestTimeoutMillis: Number(env.NATS_REQUEST_TIMEOUT_MS ?? "2000"),
      loginMethods: {
        development,
        google: Boolean(env.GOOGLE_CLIENT_ID?.trim()),
      },
      identityHttpOrigin:
        env.IDENTITY_HTTP_ORIGIN?.trim() || "http://identity-access:4002",
      authProxyTimeoutMillis: Number(env.AUTH_PROXY_TIMEOUT_MS ?? "5000"),
      authProxyMaximumResponseBytes: Number(
        env.AUTH_PROXY_MAX_RESPONSE_BYTES ?? "1048576"
      ),
      telemetryHttpOrigin:
        env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
        "http://otel-collector:4318",
      telemetryProxyTimeoutMillis: Number(
        env.TELEMETRY_PROXY_TIMEOUT_MS ?? "5000"
      ),
      telemetryProxyMaximumRequestBytes: Number(
        env.TELEMETRY_PROXY_MAX_REQUEST_BYTES ?? "1048576"
      ),
      telemetryProxyMaximumResponseBytes: Number(
        env.TELEMETRY_PROXY_MAX_RESPONSE_BYTES ?? "1048576"
      ),
    }).pipe(Effect.mapError(configFailure))
  })
