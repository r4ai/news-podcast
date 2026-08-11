import type { Observability } from "./contract.js"

export const noopObservability: Observability = {
  log: () => undefined,
  withSpan: (_name, _attributes, operation) => operation(),
  withGuaranteedSpan: (_name, operation) => operation(),
  assertActiveSpan: () => undefined,
  count: () => undefined,
  measure: () => undefined,
  gauge: () => undefined,
  captureContext: () => undefined,
  shutdown: () => Promise.resolve(),
}
