import { describe, expect, it } from "vitest"

import { createTerminalDeliveryQueue } from "./terminal-delivery-queue.js"

describe("terminal delivery queue", () => {
  it("rejects a pending receive as soon as any subscription fails", async () => {
    const queue = createTerminalDeliveryQueue<number>()
    const pending = queue.receive()

    queue.terminate(new Error("subscription failed"))

    await expect(pending).rejects.toThrow("subscription failed")
  })

  it("does not hide a terminal failure behind already queued deliveries", async () => {
    const queue = createTerminalDeliveryQueue<number>()
    queue.offer(1)
    queue.terminate(new Error("subscription ended"))

    await expect(queue.receive()).rejects.toThrow("subscription ended")
  })

  it("delivers directly to a waiter and ignores offers after termination", async () => {
    const queue = createTerminalDeliveryQueue<number>()
    const pending = queue.receive()
    queue.offer(42)
    await expect(pending).resolves.toBe(42)

    queue.terminate(new Error("done"))
    queue.terminate(new Error("ignored"))
    queue.offer(43)
    await expect(queue.receive()).rejects.toThrow("done")
  })

  it("returns a buffered undefined value without confusing it with an empty queue", async () => {
    const queue = createTerminalDeliveryQueue<number | undefined>()
    await queue.offer(undefined)
    await expect(queue.receive()).resolves.toBeUndefined()
  })

  it("backpressures producers after one buffered delivery", async () => {
    const queue = createTerminalDeliveryQueue<number>()
    await queue.offer(1)
    let accepted = false
    const second = queue.offer(2).then(() => {
      accepted = true
    })

    await Promise.resolve()
    expect(accepted).toBe(false)
    await expect(queue.receive()).resolves.toBe(1)
    await second
    await expect(queue.receive()).resolves.toBe(2)
  })
})
