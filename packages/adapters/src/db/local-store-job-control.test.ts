import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("episode job control", () => {
  it("cancels active work in the owner scope", async () => {
    const store = createStore()
    const job = await createJob(store, "owner-1", "cancel")
    const leased = store.leaseNext()
    expect(leased?.id).toBe(job.jobId)

    expect(store.cancelJob("owner-2", job.jobId)).toBe("not_found")
    expect(store.cancelJob("owner-1", job.jobId)).toBe("canceled")
    expect(store.getJob("owner-1", job.jobId)).toMatchObject({
      status: "canceled",
    })
    expect(store.cancelJob("owner-1", job.jobId)).toBe("terminal")
    store.close()
  })

  it("retries a failed job under a new ID with the original feed snapshot", async () => {
    const store = createStore()
    const feedId = "00000000-0000-4000-8000-000000000001"
    const original = await createJob(store, "owner-1", "retry", [feedId])
    const leased = store.leaseNext()
    store.failJob(original.jobId, leased!.leaseToken, {
      code: "provider-timeout",
      message: "temporary provider failure",
      retryable: true,
    })

    expect(store.retryFailedJob("owner-2", original.jobId)).toBeUndefined()
    const retried = store.retryFailedJob("owner-1", original.jobId)
    expect(retried).toMatchObject({ status: "queued", attempt: 0 })
    expect(retried?.id).not.toBe(original.jobId)
    expect(store.getJobFeeds(retried!.id).map((feed) => feed.id)).toEqual([
      feedId,
    ])
    expect(store.retryFailedJob("owner-1", retried!.id)).toBeUndefined()
    store.close()
  })
})

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "job-control-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

function createJob(
  store: LocalStore,
  ownerId: string,
  key: string,
  feedIds: readonly string[] = []
) {
  return store.create({
    ownerId,
    idempotencyKey: key,
    requestHash: `hash-${key}`,
    trigger: "manual",
    feedIds,
  })
}
