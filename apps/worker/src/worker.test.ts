import { describe, expect, it, vi } from "vitest"

import { createPollingWorker } from "./worker.js"

describe("polling worker foundation", () => {
  it("does no work when no lease is available", async () => {
    const process = vi.fn()
    const worker = createPollingWorker(
      { leaseNext: vi.fn().mockResolvedValue(null) },
      { process },
    )

    await expect(worker.runOnce(new Date(0))).resolves.toBe("idle")
    expect(process).not.toHaveBeenCalled()
  })

  it("passes only the owner and job identifiers to the processor", async () => {
    const process = vi.fn().mockResolvedValue(undefined)
    const worker = createPollingWorker(
      {
        leaseNext: vi.fn().mockResolvedValue({
          ownerId: "owner-1",
          jobId: "job-1",
          status: "running",
          leaseToken: "lease-1",
        }),
      },
      { process },
    )

    await expect(worker.runOnce(new Date(0))).resolves.toBe("processed")
    expect(process).toHaveBeenCalledWith({ ownerId: "owner-1", jobId: "job-1" })
  })
})
