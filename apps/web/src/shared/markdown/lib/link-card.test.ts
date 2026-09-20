import { describe, expect, it } from "vitest"
import { parseLinkCardMetadata } from "./link-card"
describe("archived card metadata", () => {
  it.each([
    undefined,
    "plain title",
    "link-card:v1:{",
    "link-card:v1:null",
    "link-card:v1:[]",
    "link-card:v1:42",
    "link-card:v1:" + "x".repeat(6000),
  ])("falls back for %s", (value) => {
    expect(parseLinkCardMetadata(value)).toEqual({})
  })
  it("reads bounded strings and rejects unsafe images", () => {
    expect(
      parseLinkCardMetadata(
        "link-card:v1:" +
          JSON.stringify({
            title: " Title ",
            description: 42,
            image: "javascript:x",
          })
      )
    ).toEqual({ title: "Title", description: undefined, image: undefined })
    expect(
      parseLinkCardMetadata(
        "link-card:v1:" +
          JSON.stringify({
            title: "x".repeat(300),
            description: " ",
            image: "https://example.com/og.png",
          })
      ).title
    ).toHaveLength(256)
  })
})

it.each(["javascript:x", "data:image/png,x"])(
  "rejects unsafe favicon %s",
  (favicon) => {
    expect(
      parseLinkCardMetadata("link-card:v1:" + JSON.stringify({ favicon }))
        .favicon
    ).toBeUndefined()
  }
)
