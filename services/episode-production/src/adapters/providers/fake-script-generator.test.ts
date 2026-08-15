import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeFakeScriptGenerator } from "./fake-script-generator.js"

describe("fake script generator", () => {
  it("returns a deterministic bounded script without a provider credential", async () => {
    const result = await Effect.runPromise(
      makeFakeScriptGenerator().generate({
        sources: [
          {
            title: "SQLiteの運用",
            url: "https://example.com/sqlite",
            markdown: "WAL mode improves writer concurrency.",
          },
        ],
      })
    )

    expect(result).toEqual({
      title: "ローカル検証ニュース",
      script:
        "これはローカル検証用のfake providerが生成した台本です。SQLiteの運用を確認しました。",
      sourceUrls: ["https://example.com/sqlite"],
    })
  })
})
