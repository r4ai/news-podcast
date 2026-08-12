import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseResolveSessionReply,
  parseResolveSessionRequest,
} from "./identity-rpc.js"

describe("identity RPC contracts", () => {
  it("parses and freezes the request and both reply states", async () => {
    const [request, resolved, rejected] = await Effect.runPromise(
      Effect.all([
        parseResolveSessionRequest({
          headers: [{ name: "cookie", value: "session=opaque" }],
        }),
        parseResolveSessionReply({
          actor: {
            _tag: "User",
            userId: "better-auth-user_01",
          },
        }),
        parseResolveSessionReply({
          _tag: "Rejected",
          code: "SESSION_PROVIDER_FAILURE",
        }),
      ])
    )

    expect(Object.isFrozen(request.headers[0])).toBe(true)
    expect(resolved).toMatchObject({ actor: { _tag: "User" } })
    expect(rejected).toEqual({
      _tag: "Rejected",
      code: "SESSION_PROVIDER_FAILURE",
    })
  })

  it.each([
    ["unknown request field", { headers: [], debug: true }],
    ["invalid header name", { headers: [{ name: "bad header", value: "x" }] }],
    [
      "too many headers",
      {
        headers: Array.from({ length: 101 }, () => ({
          name: "cookie",
          value: "x",
        })),
      },
    ],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseResolveSessionRequest(input))

    expect(exit._tag).toBe("Failure")
  })
})
