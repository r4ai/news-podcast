import { describe, expect, it } from "vitest"

import type { SiteProfile } from "../core/contracts.js"
import { selectSiteProfile } from "./registry.js"

describe("site profile registry", () => {
  it.each([
    ["https://zenn.dev/a", "zenn"],
    ["https://qiita.com/a", "qiita"],
    ["https://zenn.dev.evil.example/a", undefined],
    ["https://sub.zenn.dev/a", undefined],
  ])("matches exact normalized hosts", (url, expected) => {
    expect(selectSiteProfile(new URL(url))?.id).toBe(expected)
  })

  it("supports an injected immutable registry", () => {
    const custom = {
      id: "zenn",
      hosts: ["custom.example"],
      articleRoot: "article",
      remove: [],
      filenameSelectors: [],
      callouts: [],
    } satisfies SiteProfile
    expect(selectSiteProfile(new URL("https://custom.example"), [custom])).toBe(
      custom
    )
  })
})
