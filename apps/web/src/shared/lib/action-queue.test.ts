import { describe, expect, it } from "vitest"

import { createActionQueue } from "./action-queue"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

describe("createActionQueue", () => {
  it("starts the next action only after the previous one settles", async () => {
    const queue = createActionQueue()
    const first = deferred<string>()
    const second = deferred<string>()
    const started: string[] = []

    const firstRun = queue(() => {
      started.push("first")
      return first.promise
    })
    const secondRun = queue(() => {
      started.push("second")
      return second.promise
    })

    // 直列化されるので、1件目が解決するまで2件目は起動しない。
    await Promise.resolve()
    expect(started).toEqual(["first"])

    first.resolve("a")
    await firstRun
    // 起動はマイクロタスク境界を1つ跨ぐので、そこまで進めてから確認する。
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["first", "second"])

    second.resolve("b")
    await expect(secondRun).resolves.toBe("b")
  })

  it("keeps draining after a failure and reports it to that caller only", async () => {
    const queue = createActionQueue()
    const failing = queue(() => Promise.reject(new Error("boom")))
    const following = queue(() => Promise.resolve("ok"))

    await expect(failing).rejects.toThrow("boom")
    await expect(following).resolves.toBe("ok")
  })

  it("preserves submission order under a burst", async () => {
    const queue = createActionQueue()
    const completed: number[] = []
    const delays = [30, 1, 20, 0, 10]

    await Promise.all(
      delays.map((delay, index) =>
        queue(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay))
          completed.push(index)
        })
      )
    )

    // 遅い処理が先でも、投入順のまま反映される。
    expect(completed).toEqual([0, 1, 2, 3, 4])
  })

  it("runs independent queues concurrently", async () => {
    const left = createActionQueue()
    const right = createActionQueue()
    const blocker = deferred<void>()
    const order: string[] = []

    const blocked = left(() =>
      blocker.promise.then(() => void order.push("left"))
    )
    await right(async () => void order.push("right"))
    expect(order).toEqual(["right"])

    blocker.resolve()
    await blocked
    expect(order).toEqual(["right", "left"])
  })
})
