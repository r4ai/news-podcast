import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  anonymousActor,
  authenticatedActor,
  parseAuthenticatedActor,
  parseUserId,
} from "./actor.js"

describe("Actor", () => {
  it("constructs deeply immutable anonymous and authenticated states", async () => {
    const userId = await Effect.runPromise(parseUserId("better-auth-user-1"))
    const actor = authenticatedActor(userId)

    expect(anonymousActor).toEqual({ _tag: "Anonymous" })
    expect(actor).toEqual({
      _tag: "Authenticated",
      userId: "better-auth-user-1",
    })
    expect(Object.isFrozen(anonymousActor)).toBe(true)
    expect(Object.isFrozen(actor)).toBe(true)
  })

  it.each(["", "   ", "x".repeat(256)])(
    "rejects an invalid Better Auth user id: %j",
    async (input) => {
      const exit = await Effect.runPromiseExit(parseUserId(input))

      expect(exit._tag).toBe("Failure")
    }
  )

  it("rejects actor states outside the domain union", async () => {
    const exit = await Effect.runPromiseExit(
      parseAuthenticatedActor({ _tag: "Admin", userId: "user-1" })
    )

    expect(exit._tag).toBe("Failure")
  })

  it("rejects whitespace and oversized provider IDs", async () => {
    for (const input of ["user id", "x".repeat(256)]) {
      const exit = await Effect.runPromiseExit(parseUserId(input))
      expect(exit._tag).toBe("Failure")
    }
  })
})
