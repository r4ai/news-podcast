import type { ObjectStore } from "@news-podcast/application"
import {
  noopObservability,
  type Observability,
  type SpanOptions,
} from "@news-podcast/observability"
import { describe, expect, it, vi } from "vitest"

import { createObservedObjectStore } from "./observed-object-store.js"

describe("observed object store", () => {
  it("wraps S3 operations in client spans without recording object keys", async () => {
    const spans: Array<{
      name: string
      attributes: Readonly<Record<string, string | number | boolean>>
      options?: SpanOptions
    }> = []
    const observability: Observability = {
      ...noopObservability,
      withSpan: async (name, attributes, operation, options) => {
        spans.push({ name, attributes, ...(options ? { options } : {}) })
        return operation()
      },
    }
    const delegate: ObjectStore = {
      put: vi.fn(async (input) => ({
        key: input.key,
        byteLength: input.body.byteLength,
        contentType: input.contentType,
      })),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    }
    const store = createObservedObjectStore(delegate, observability)

    await store.put({
      key: "private/job/chunk.wav",
      body: new Uint8Array([1]),
      contentType: "audio/wav",
    })
    await store.get("private/job/chunk.wav")
    await store.delete("private/job/chunk.wav")

    expect(spans).toEqual([
      {
        name: "provider.s3.put",
        attributes: { "provider.name": "s3", "provider.operation": "put" },
        options: { kind: "client" },
      },
      {
        name: "provider.s3.get",
        attributes: { "provider.name": "s3", "provider.operation": "get" },
        options: { kind: "client" },
      },
      {
        name: "provider.s3.delete",
        attributes: {
          "provider.name": "s3",
          "provider.operation": "delete",
        },
        options: { kind: "client" },
      },
    ])
    expect(JSON.stringify(spans)).not.toContain("private/job/chunk.wav")
  })
})
