import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { IN_MEMORY_DATABASE_PATH } from "./client.js"
import {
  attemptDatabase,
  databaseOperation,
  scopedDatabaseClient,
} from "./effect.js"

describe("attemptDatabase", () => {
  it("returns the value when the synchronous driver succeeds", async () => {
    const result = await Effect.runPromise(attemptDatabase("Find", () => 42))

    expect(result).toBe(42)
  })

  it("maps a constraint violation to a distinguishable reason", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        attemptDatabase("Save", () => {
          throw new Error("UNIQUE constraint failed: episodes.id")
        })
      )
    )
    expect(failure).toEqual({
      _tag: "DatabaseFailed",
      operation: "Save",
      reason: "ConstraintViolated",
    })
  })

  it("maps an unexpected driver fault to Unavailable", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        attemptDatabase("Find", () => {
          throw new Error("disk I/O error")
        })
      )
    )

    expect(failure.reason).toBe("Unavailable")
  })
})

describe("databaseOperation", () => {
  it("carries the value through the instrumented path", async () => {
    const result = await Effect.runPromise(
      databaseOperation({
        namespace: "episode-library",
        operation: "SELECT",
        spanName: "sqlite episodes list",
        run: () => ["a", "b"],
      })
    )

    expect(result).toEqual(["a", "b"])
  })

  it("preserves the typed failure when instrumented", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        databaseOperation({
          namespace: "episode-library",
          operation: "INSERT",
          spanName: "sqlite episodes insert",
          run: () => {
            throw new Error("FOREIGN KEY constraint failed")
          },
        })
      )
    )

    expect(failure).toEqual({
      _tag: "DatabaseFailed",
      operation: "INSERT",
      reason: "ConstraintViolated",
    })
  })
})

describe("scopedDatabaseClient", () => {
  it("closes the connection when the scope ends", async () => {
    const client = await Effect.runPromise(
      Effect.scoped(
        scopedDatabaseClient({ path: IN_MEMORY_DATABASE_PATH }).pipe(
          Effect.map((value) => value)
        )
      )
    )

    // 閉じた接続への操作は失敗する。スコープ解放が実際に効いていることの確認。
    expect(() => client.prepare("SELECT 1").get()).toThrow()
  })
})
