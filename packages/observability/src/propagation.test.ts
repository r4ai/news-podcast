import { describe, expect, it, afterEach, beforeEach } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"
import {
  context,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type Context,
  type ContextManager,
} from "@opentelemetry/api"

import {
  makeAllowlistTextMapPropagator,
  installPropagationGate,
  propagationDisabledKey,
  readPropagationAllowlist,
} from "./propagation.js"

// context.with を実効化するための最小ContextManager（NodeSDK非依存）。
class StorageContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>()
  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const callback = fn as unknown as (
      ...callbackArgs: unknown[]
    ) => ReturnType<F>
    return this.storage.run(
      ctx,
      callback,
      thisArg as ThisParameterType<F>,
      ...(args as unknown[])
    )
  }
  bind<T>(_context: Context, target: T): T {
    return target
  }
  enable(): this {
    return this
  }
  disable(): this {
    return this
  }
}

function sampledContext(): {
  context: ReturnType<typeof context.active>
  traceId: string
} {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736"
  const spanId = "00f067aa0ba902b7"
  const ctx = trace.setSpanContext(context.active(), {
    traceId,
    spanId,
    isRemote: false,
    traceFlags: TraceFlags.SAMPLED,
  })
  return { context: ctx, traceId }
}

describe("propagation allowlist gate", () => {
  beforeEach(() => {
    context.setGlobalContextManager(new StorageContextManager())
  })
  afterEach(() => {
    context.disable()
  })

  it("reads the allowlist from the environment with a safe default", () => {
    expect(readPropagationAllowlist({})).toEqual(
      new Set(["api.openai.com", "127.0.0.1", "localhost"])
    )
    expect(
      readPropagationAllowlist({
        OTEL_PROPAGATION_ALLOWLIST: "collector:4318, example.com",
      })
    ).toEqual(new Set(["collector:4318", "example.com"]))
  })

  it("injects W3C context unless propagation is disabled", () => {
    const propagator = makeAllowlistTextMapPropagator()
    const { context: ctx } = sampledContext()

    const injected: Record<string, string> = {}
    propagator.inject(ctx, injected, defaultTextMapSetter)
    expect(injected["traceparent"]).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    )

    const flagged = ctx.setValue(propagationDisabledKey, true)
    const suppressed: Record<string, string> = {}
    propagator.inject(flagged, suppressed, defaultTextMapSetter)
    expect(suppressed).not.toHaveProperty("traceparent")
  })

  it("always extracts remote context even when injection is disabled", () => {
    const propagator = makeAllowlistTextMapPropagator()
    const carrier = {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    }
    const extracted = propagator.extract(context.active(), carrier, {
      keys: (carrier) => Object.keys(carrier),
      get: (carrier, key) => carrier[key],
    })
    const spanContext = trace.getSpanContext(extracted)
    expect(spanContext?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736")
  })

  it("disables injection to non-allowlisted hosts via the global fetch wrapper", async () => {
    const originalFetch = globalThis.fetch
    try {
      const calls: Array<{ host: string; disabled: boolean }> = []
      const stub = async (input: RequestInfo | URL): Promise<Response> => {
        const host = new URL(String(input)).hostname
        const disabled =
          context.active().getValue(propagationDisabledKey) === true
        calls.push({ host, disabled })
        return new Response(null, { status: 200 })
      }
      globalThis.fetch = stub as typeof fetch
      installPropagationGate(new Set(["api.openai.com"]))

      await globalThis.fetch("https://rss.example.com/feed.xml")
      await globalThis.fetch("https://api.openai.com/v1/responses")

      expect(calls).toEqual([
        { host: "rss.example.com", disabled: true },
        { host: "api.openai.com", disabled: false },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
