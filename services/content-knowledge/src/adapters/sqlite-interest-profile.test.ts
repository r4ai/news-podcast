import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { createInterestProfileOperations } from "../application/interest-profile.js"
import { parseInterestProfile } from "../domain/interest-profile.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { openTestDatabase, type TestDatabase } from "./persistence/testing.js"
import { createInterestProfileRepository } from "./persistence/interest-profile/repository.js"

const databases: TestDatabase[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

describe("SQLite interest profiles", () => {
  it("defaults safely and stores independent owner projections", async () => {
    const database = openTestDatabase()
    databases.push(database)
    const repository = await Effect.runPromise(
      createInterestProfileRepository(
        database.db,
        () => "2026-08-13T01:00:00.000Z"
      )
    )
    const operations = createInterestProfileOperations(repository)
    const ownerA = Schema.decodeUnknownSync(OwnerIdSchema)("owner-a")
    const ownerB = Schema.decodeUnknownSync(OwnerIdSchema)("owner-b")

    expect(await Effect.runPromise(operations.get(ownerA))).toEqual({
      include: "",
      exclude: "",
    })
    const profile = await Effect.runPromise(
      parseInterestProfile({
        include: "functional programming",
        exclude: "ads",
      })
    )
    await Effect.runPromise(operations.update(ownerA, profile))
    expect(await Effect.runPromise(operations.get(ownerA))).toEqual(profile)
    expect(await Effect.runPromise(operations.get(ownerB))).toEqual({
      include: "",
      exclude: "",
    })
  })

  it("rejects oversized profile text at the domain boundary", async () => {
    await expect(
      Effect.runPromise(
        parseInterestProfile({ include: "x".repeat(2_001), exclude: "" })
      )
    ).rejects.toBeDefined()
  })
})
