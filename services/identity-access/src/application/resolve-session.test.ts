import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"

import { authenticatedActor, parseUserId } from "../domain/actor.js"
import { resolveSession } from "./resolve-session.js"
import type { SessionLookupRequest, SessionReader } from "./session-reader.js"

const request: SessionLookupRequest = {
  headers: [{ name: "cookie", value: "better-auth.session_token=token" }],
}

describe("resolveSession", () => {
  it("returns the authenticated actor supplied by the session port", async () => {
    const userId = await Effect.runPromise(parseUserId("user-1"))
    const expected = authenticatedActor(userId)
    const reader: SessionReader = {
      findAuthenticatedActor: () => Effect.succeed(Option.some(expected)),
    }

    const actor = await Effect.runPromise(resolveSession(reader)(request))

    expect(actor).toBe(expected)
    expect(Object.isFrozen(actor)).toBe(true)
  })

  it("models a missing session as the anonymous actor", async () => {
    const reader: SessionReader = {
      findAuthenticatedActor: () => Effect.succeed(Option.none()),
    }

    const actor = await Effect.runPromise(resolveSession(reader)(request))

    expect(actor).toEqual({ _tag: "Anonymous" })
    expect(Object.isFrozen(actor)).toBe(true)
  })
})
