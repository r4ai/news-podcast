import type { ObjectStore } from "@news-podcast/application"
import type { Observability } from "@news-podcast/observability"

export function createObservedObjectStore(
  delegate: ObjectStore,
  observability: Observability
): ObjectStore {
  return {
    put: (input) =>
      observability.withSpan(
        "provider.s3.put",
        { "provider.name": "s3", "provider.operation": "put" },
        () => delegate.put(input),
        { kind: "client" }
      ),
    get: (key, signal) =>
      observability.withSpan(
        "provider.s3.get",
        { "provider.name": "s3", "provider.operation": "get" },
        () => delegate.get(key, signal),
        { kind: "client" }
      ),
    delete: (key, signal) =>
      observability.withSpan(
        "provider.s3.delete",
        { "provider.name": "s3", "provider.operation": "delete" },
        () => delegate.delete(key, signal),
        { kind: "client" }
      ),
  }
}
