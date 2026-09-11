import { runArchiveRefreshWorker } from "../../../runtime/loops/archive-refresh.js"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { openTestDatabase } from "../testing.js"
import { createArchiveRefreshQueue } from "./repository.js"
import type { ArchiveRefreshInput } from "../../../application/archive-refresh.js"

const databases: ReturnType<typeof openTestDatabase>[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
const now = "2026-09-11T00:00:00.000Z"
const setup = () => {
  const db = openTestDatabase()
  databases.push(db)
  const feedId = randomUUID()
  db.runSql(
    "INSERT INTO feed_catalog(feed_id, feed_url, created_at) VALUES (?, ?, ?)",
    [feedId, "https://example.com/feed", now]
  )
  const input = (owner = "owner-a"): ArchiveRefreshInput => {
    const articleId = randomUUID()
    db.runSql(
      "INSERT INTO feed_items(article_id, feed_id, external_id, source_url, title, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        articleId,
        feedId,
        articleId,
        "https://example.com/article",
        "Article",
        now,
      ]
    )
    return {
      ownerId: owner,
      articleId,
      context: {
        messageId: randomUUID(),
        correlationId: randomUUID(),
        traceparent: "00-123e4567e89b42d3a456426614174000-123e4567e89b42d3-01",
        actor: { _tag: "User", userId: owner },
      },
    } as ArchiveRefreshInput
  }
  return { db, input, queue: createArchiveRefreshQueue(db.db, randomUUID) }
}
describe("durable archive refresh admission", () => {
  it("coalesces active owner/article jobs and hides receipts from other owners", async () => {
    const { queue, input } = setup()
    const command = input()
    const first = await Effect.runPromise(queue.enqueue(command, now))
    const second = await Effect.runPromise(
      queue.enqueue(
        {
          ...command,
          context: { ...command.context, messageId: randomUUID() as never },
        },
        now
      )
    )
    expect(second).toEqual({ job: first.job, reused: true })
    expect(
      await Effect.runPromise(
        queue.find("owner-b", command.articleId, first.job.jobId, now)
      )
    ).toBeUndefined()
    expect(
      await Effect.runPromise(
        queue.find(command.ownerId, randomUUID(), first.job.jobId, now)
      )
    ).toBeUndefined()
  })
  it("enforces owner and global active capacity transactionally", async () => {
    const { queue, input } = setup()
    for (let index = 0; index < 2; index++)
      await Effect.runPromise(queue.enqueue(input(), now))
    expect(
      await Effect.runPromise(Effect.flip(queue.enqueue(input(), now)))
    ).toMatchObject({ reason: "capacity" })
    for (let index = 0; index < 30; index++)
      await Effect.runPromise(queue.enqueue(input(`owner-${index}`), now))
    expect(
      await Effect.runPromise(Effect.flip(queue.enqueue(input("other"), now)))
    ).toMatchObject({ reason: "capacity" })
  })
  it("limits repeated completed work and admits after the rate window", async () => {
    const { queue, input } = setup()
    const command = input()
    for (let index = 0; index < 4; index++) {
      const { job } = await Effect.runPromise(queue.enqueue(command, now))
      await Effect.runPromise(queue.claim(now))
      await Effect.runPromise(queue.complete(job.jobId, null, now))
    }
    expect(
      await Effect.runPromise(Effect.flip(queue.enqueue(command, now)))
    ).toMatchObject({ reason: "rate" })
    expect(
      (
        await Effect.runPromise(
          queue.enqueue(command, "2026-09-11T00:01:01.000Z")
        )
      ).job.status
    ).toBe("queued")
  })
  it("enforces the global rate across completed jobs", async () => {
    const { queue, input } = setup()
    for (let index = 0; index < 60; index++) {
      const { job } = await Effect.runPromise(
        queue.enqueue(input(`owner-${index}`), now)
      )
      await Effect.runPromise(queue.claim(now))
      await Effect.runPromise(queue.complete(job.jobId, null, now))
    }
    expect(
      await Effect.runPromise(Effect.flip(queue.enqueue(input("other"), now)))
    ).toMatchObject({ reason: "rate" })
  })
  it.each(["success", "failure", "defect", "deadline", "cancel"] as const)(
    "persists worker %s and emits its outcome",
    async (mode) => {
      const { queue, input } = setup()
      const command = input()
      const { job } = await Effect.runPromise(queue.enqueue(command, now))
      let ticks = 0
      const clock = () =>
        mode === "deadline" && ticks++ > 0 ? "2026-09-11T00:01:59.995Z" : now
      const events: string[] = []
      const execute = () =>
        mode === "success"
          ? Effect.void
          : mode === "failure"
            ? Effect.fail("capture")
            : mode === "defect"
              ? Effect.die("capture")
              : Effect.never
      await Effect.runPromiseExit(
        runArchiveRefreshWorker(
          queue,
          execute,
          (value) => events.push(value.event),
          clock
        ).pipe(Effect.timeout(40))
      )
      const expected = mode === "success" ? "succeeded" : "failed"
      expect(
        await Effect.runPromise(
          queue.find(command.ownerId, command.articleId, job.jobId, now)
        )
      ).toMatchObject({
        status: expected,
        error:
          mode === "success"
            ? null
            : mode === "deadline"
              ? "deadline"
              : mode === "cancel"
                ? "canceled"
                : "capture",
      })
      expect(events).toContain(
        mode === "success"
          ? "succeeded"
          : mode === "deadline"
            ? "deadline"
            : mode === "cancel"
              ? "canceled"
              : "failed"
      )
    }
  )
  it("shares one processing slot across queue instances and never revives expired work", async () => {
    const { queue, input, db } = setup()
    const command = input()
    const { job } = await Effect.runPromise(queue.enqueue(command, now))
    expect((await Effect.runPromise(queue.claim(now)))?.job.status).toBe(
      "processing"
    )
    const restarted = createArchiveRefreshQueue(db.db, randomUUID)
    expect(await Effect.runPromise(restarted.claim(now))).toBeUndefined()
    const expired = "2026-09-11T00:02:01.000Z"
    expect(
      await Effect.runPromise(
        restarted.find(command.ownerId, command.articleId, job.jobId, expired)
      )
    ).toMatchObject({ status: "failed", error: "deadline" })
    await Effect.runPromise(queue.complete(job.jobId, null, expired))
    expect(
      await Effect.runPromise(
        restarted.find(command.ownerId, command.articleId, job.jobId, expired)
      )
    ).toMatchObject({ status: "failed" })
    expect(
      await Effect.runPromise(
        restarted.find(
          command.ownerId,
          command.articleId,
          job.jobId,
          "2026-09-12T00:00:01.000Z"
        )
      )
    ).toBeUndefined()
  })
})
