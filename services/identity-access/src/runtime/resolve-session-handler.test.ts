import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"

import { authenticatedActor, parseUserId } from "../domain/actor.js"
import { makeResolveSessionHandler } from "./resolve-session-handler.js"

describe("resolve session handler", () => {
  it("parses unknown transport data before invoking the use case", async () => {
    const userId = await Effect.runPromise(parseUserId("user-1"))
    const findAuthenticatedActor = vi
      .fn()
      .mockReturnValue(Effect.succeed(Option.some(authenticatedActor(userId))))
    const handler = makeResolveSessionHandler({ findAuthenticatedActor })

    const actor = await Effect.runPromise(
      handler({ headers: [{ name: "cookie", value: "session=token" }] })
    )

    expect(actor).toEqual({ _tag: "Authenticated", userId: "user-1" })
    expect(Object.isFrozen(actor)).toBe(true)
    const parsedRequest = findAuthenticatedActor.mock.calls[0]?.[0]
    expect(Object.isFrozen(parsedRequest)).toBe(true)
    expect(Object.isFrozen(parsedRequest.headers)).toBe(true)
  })

  it.each([
    ["non-array headers", { headers: {} }],
    ["malformed header", { headers: [{ name: "cookie" }] }],
    ["unknown input field", { headers: [], debug: true }],
  ])("rejects %s before invoking the port", async (_case, input) => {
    const findAuthenticatedActor = vi.fn()
    const handler = makeResolveSessionHandler({ findAuthenticatedActor })

    const exit = await Effect.runPromiseExit(handler(input))

    expect(exit._tag).toBe("Failure")
    expect(findAuthenticatedActor).not.toHaveBeenCalled()
  })
})
