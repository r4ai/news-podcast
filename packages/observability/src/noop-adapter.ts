import type { Observability } from "./contract.js"

export const noopObservability: Observability = {
  log: () => undefined,
  withSpan: (_name, _attributes, operation) => operation(),
  count: () => undefined,
  measure: () => undefined,
  captureContext: () => undefined,
  shutdown: () => Promise.resolve(),
}
