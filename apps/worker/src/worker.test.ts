import { describe, expect, it, vi } from "vitest"

import { createPollingWorker } from "./worker.js"

describe("polling worker foundation", () => {
  it("does no work when no lease is available", async () => {
    const process = vi.fn()
    const worker = createPollingWorker(
      { leaseNext: vi.fn().mockResolvedValue(null) },
      { process }
    )

    await expect(worker.runOnce(new Date(0))).resolves.toBe("idle")
    expect(process).not.toHaveBeenCalled()
  })

  it("passes the durable trace context to the processor", async () => {
    const process = vi.fn().mockResolvedValue(undefined)
    const traceContext = {
      traceParent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      traceState: "vendor=value",
    }
    const worker = createPollingWorker(
      {
        leaseNext: vi.fn().mockResolvedValue({
          ownerId: "owner-1",
          jobId: "job-1",
          status: "running",
          leaseToken: "lease-1",
          traceContext,
        }),
      },
      { process }
    )

    await expect(worker.runOnce(new Date(0))).resolves.toBe("processed")
    expect(process).toHaveBeenCalledWith({
      ownerId: "owner-1",
      jobId: "job-1",
      traceContext,
    })
  })
})
