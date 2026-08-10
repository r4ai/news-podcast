import { trace } from "@opentelemetry/api"
import { describe, expect, it } from "vitest"

import { extractRemoteContext } from "./w3c.js"

describe("W3C remote trace context", () => {
  it("extracts a valid sampled remote parent", () => {
    const extracted = trace.getSpanContext(
      extractRemoteContext({
        traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        traceState: "vendor=value",
      })
    )

    expect(extracted).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
      isRemote: true,
      traceState: expect.objectContaining({ serialize: expect.any(Function) }),
    })
    expect(extracted?.traceState?.serialize()).toBe("vendor=value")
  })

  it("ignores malformed trace context", () => {
    expect(
      trace.getSpanContext(
        extractRemoteContext({ traceParent: "not-a-trace-parent" })
      )
    ).toBeUndefined()
  })
})
