import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStore } from "@news-podcast/adapters/db/local"

import { createApp } from "./app.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("episode job control API", () => {
  it("creates a new retry job and can cancel it", async () => {
    const store = createStore()
    const original = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "original",
      requestHash: "snapshot-hash",
      trigger: "manual",
      feedIds: ["00000000-0000-4000-8000-000000000001"],
    })
    const leased = store.leaseNext()!
    store.failJob(original.jobId, leased.leaseToken, {
      code: "provider-timeout",
      message: "timeout",
      retryable: true,
    })
    const app = createApp({
      store,
      resolveOwner: async () => "owner-1",
    })

    const retryResponse = await app.request(
      `/v1/episode-jobs/${original.jobId}/retry`,
      { method: "POST" }
    )
    expect(retryResponse.status).toBe(202)
    const retried = (await retryResponse.json()) as { id: string }
    expect(retried.id).not.toBe(original.jobId)
    expect(retryResponse.headers.get("Location")).toBe(
      `/v1/episode-jobs/${retried.id}`
    )

    const cancelResponse = await app.request(
      `/v1/episode-jobs/${retried.id}/cancel`,
      { method: "POST" }
    )
    expect(cancelResponse.status).toBe(200)
    await expect(cancelResponse.json()).resolves.toMatchObject({
      id: retried.id,
      status: "canceled",
    })
    store.close()
  })

  it("normalizes an out-of-scope job to not found", async () => {
    const store = createStore()
    const app = createApp({ store, resolveOwner: async () => "owner-2" })

    const response = await app.request(
      "/v1/episode-jobs/00000000-0000-4000-8000-000000000001/cancel",
      { method: "POST" }
    )
    expect(response.status).toBe(404)
    store.close()
  })
})

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "api-job-control-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}
