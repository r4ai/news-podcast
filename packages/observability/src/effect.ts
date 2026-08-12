import { Effect, Layer, Tracer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Otlp } from "effect/unstable/observability"

export type EffectOtlpConfig = Readonly<{
  serviceName: string
  serviceVersion: string
  environment: string
  endpoint: string
}>

/** Effect-native OTLP logs, metrics and traces with correlated log records. */
export const makeEffectOtlpLayer = (config: EffectOtlpConfig) =>
  Otlp.layerJson({
    baseUrl: config.endpoint.replace(/\/$/, ""),
    resource: {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      attributes: {
        "deployment.environment.name": config.environment,
        "telemetry.schema.version": "1",
      },
    },
    loggerExcludeLogSpans: true,
    loggerMergeWithExisting: true,
  }).pipe(Layer.provide(FetchHttpClient.layer))

/** Uses the same service identity and OTLP endpoint as the Node SDK boundary. */
export const makeEffectOtlpLayerFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  serviceName: string
) => {
  if (environment.OTEL_ENABLED !== "true") return Layer.empty
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!endpoint)
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL is enabled")
  return makeEffectOtlpLayer({
    serviceName,
    serviceVersion: environment.OTEL_SERVICE_VERSION?.trim() || "development",
    environment: environment.APP_ENV?.trim() || "development",
    endpoint,
  })
}

export const traceparentToExternalSpan = (
  traceparent: string
): Tracer.ExternalSpan | undefined => {
  const match =
    /^(?!ff)([\da-f]{2})-(?!0{32})([\da-f]{32})-(?!0{16})([\da-f]{16})-([\da-f]{2})$/.exec(
      traceparent
    )
  if (!match) return undefined
  return Tracer.externalSpan({
    traceId: match[2]!,
    spanId: match[3]!,
    sampled: (Number.parseInt(match[4]!, 16) & 1) === 1,
  })
}

export const withRemoteTraceparent = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  traceparent: string
) => {
  const parent = traceparentToExternalSpan(traceparent)
  return parent === undefined ? effect : Effect.withParentSpan(effect, parent)
}

export type MessagingOperation = "publish" | "process" | "receive" | "settle"

export const withMessagingSpan = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  subject: string,
  operation: MessagingOperation
) =>
  Effect.withSpan(effect, `nats ${operation} ${subject}`, {
    kind: operation === "publish" ? "producer" : "consumer",
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": subject,
      "messaging.operation.type": operation,
    },
  })
