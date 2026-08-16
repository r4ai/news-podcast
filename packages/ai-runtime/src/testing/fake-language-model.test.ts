import { Effect, Schema } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { describe, expect, it } from "vitest"

import { makeFakeLanguageModelLayer } from "./fake-language-model.js"

describe("fake LanguageModel layer", () => {
  it("runs through Effect AI structured output decoding", async () => {
    const schema = Schema.Struct({ selectedIds: Schema.Array(Schema.String) })
    const result = await Effect.runPromise(
      LanguageModel.generateObject({
        objectName: "selection_v1",
        prompt: "select",
        schema,
      }).pipe(
        Effect.provide(
          makeFakeLanguageModelLayer(() =>
            Effect.succeed({ selectedIds: ["article-1"] })
          )
        )
      )
    )
    expect(result.value).toEqual({ selectedIds: ["article-1"] })
  })

  it("rejects schema-invalid fake output", async () => {
    const result = await Effect.runPromiseExit(
      LanguageModel.generateObject({
        objectName: "selection_v1",
        prompt: "select",
        schema: Schema.Struct({ selectedIds: Schema.Array(Schema.String) }),
      }).pipe(
        Effect.provide(
          makeFakeLanguageModelLayer(() =>
            Effect.succeed({ selectedIds: [123] })
          )
        )
      )
    )
    expect(result._tag).toBe("Failure")
  })
})
