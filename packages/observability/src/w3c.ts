import {
  defaultTextMapGetter,
  ROOT_CONTEXT,
  trace,
  type Context,
  type SpanContext,
} from "@opentelemetry/api"
import { W3CTraceContextPropagator } from "@opentelemetry/core"

import type { TraceContext } from "./contract.js"

const propagator = new W3CTraceContextPropagator()

export function extractRemoteContext(value: TraceContext): Context {
  return propagator.extract(
    ROOT_CONTEXT,
    {
      traceparent: value.traceParent,
      ...(value.traceState ? { tracestate: value.traceState } : {}),
    },
    defaultTextMapGetter
  )
}

export function extractRemoteSpanContext(
  value: TraceContext
): SpanContext | undefined {
  return trace.getSpanContext(extractRemoteContext(value))
}
