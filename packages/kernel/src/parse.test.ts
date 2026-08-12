import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { parse } from "./parse.js"

const Input = Schema.Struct({
  title: Schema.NonEmptyString,
  nested: Schema.Struct({ count: Schema.Int }),
})

describe("parse", () => {
  it("turns unknown boundary data into a deeply immutable value", async () => {
    const parsed = await Effect.runPromise(
      parse(Input)({ title: "Daily", nested: { count: 1 } })
    )

    expect(parsed).toEqual({ title: "Daily", nested: { count: 1 } })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nested)).toBe(true)
  })

  it.each([
    ["empty branded string", { title: "", nested: { count: 1 } }],
    ["wrong primitive", { title: "Daily", nested: { count: "1" } }],
    ["unknown property", { title: "Daily", nested: { count: 1 }, debug: true }],
  ])(
    "rejects %s instead of returning a partly valid value",
    async (_case, input) => {
      const exit = await Effect.runPromiseExit(parse(Input)(input))

      expect(exit._tag).toBe("Failure")
    }
  )
})
