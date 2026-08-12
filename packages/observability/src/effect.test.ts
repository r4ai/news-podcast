import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  makeEffectOtlpLayer,
  traceparentToExternalSpan,
  withMessagingSpan,
  withRemoteTraceparent,
} from "./effect.js"

const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

describe("Effect telemetry", () => {
  it("turns W3C context into a sampled external parent", () => {
    expect(traceparentToExternalSpan(traceparent)).toMatchObject({
      _tag: "ExternalSpan",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    })
    expect(traceparentToExternalSpan("invalid")).toBeUndefined()
  })

  it("continues the remote trace for a NATS consumer span", async () => {
    const observed = await Effect.runPromise(
      withRemoteTraceparent(
        withMessagingSpan(
          Effect.currentSpan.pipe(
            Effect.map((span) => ({ traceId: span.traceId, kind: span.kind }))
          ),
          "production.create-job.v1",
          "process"
        ),
        traceparent
      )
    )

    expect(observed).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      kind: "consumer",
    })
  })

  it("constructs one combined logs metrics traces OTLP layer", () => {
    expect(
      makeEffectOtlpLayer({
        serviceName: "episode-production",
        serviceVersion: "1.0.0",
        environment: "test",
        endpoint: "http://collector:4318",
      })
    ).toBeDefined()
  })
})
