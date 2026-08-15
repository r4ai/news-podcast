import { describe, expect, it } from "vitest"

import { classifyDatabaseFailure, databaseError } from "./errors.js"

describe("databaseError", () => {
  it("defaults to Unavailable so callers must opt into finer reasons", () => {
    expect(databaseError("Find")).toEqual({
      _tag: "DatabaseFailed",
      operation: "Find",
      reason: "Unavailable",
    })
  })

  it("is frozen so a failure value cannot be mutated in flight", () => {
    expect(Object.isFrozen(databaseError("Save"))).toBe(true)
  })
})

describe("classifyDatabaseFailure", () => {
  it.each([
    ["UNIQUE constraint failed: feed_items.article_id"],
    ["CHECK constraint failed: episode_jobs"],
    ["FOREIGN KEY constraint failed"],
    ["NOT NULL constraint failed: episodes.title"],
  ])("classifies %s as a constraint violation", (message) => {
    expect(classifyDatabaseFailure(new Error(message))).toBe(
      "ConstraintViolated"
    )
  })

  it("classifies a SQLITE_CONSTRAINT error code as a constraint violation", () => {
    const cause = new Error("constraint")
    cause.name = "SQLITE_CONSTRAINT_PRIMARYKEY"

    expect(classifyDatabaseFailure(cause)).toBe("ConstraintViolated")
  })

  it("treats an unreachable database as Unavailable", () => {
    expect(classifyDatabaseFailure(new Error("database is locked"))).toBe(
      "Unavailable"
    )
  })

  it("handles a non-Error cause without throwing", () => {
    expect(classifyDatabaseFailure("boom")).toBe("Unavailable")
  })
})
