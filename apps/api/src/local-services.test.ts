import { describe, expect, it } from "vitest"

import type { LocalStore } from "@news-podcast/adapters/db/local"
import type { ObjectStore } from "@news-podcast/application"
import { createArticleAccess } from "./local-services.js"

describe("createArticleAccess", () => {
  it("keeps archived assets same-origin while scripts and connections stay disabled", async () => {
    const store = {
      getArticleObject: () => ({ key: "archive.html" }),
    } as unknown as LocalStore
    const objects = {
      get: () =>
        Promise.resolve({
          body: new TextEncoder().encode(`<!doctype html><HTML><HEAD>
            <META content="default-src 'none'; frame-ancestors 'self'" HTTP-EQUIV=CONTENT-SECURITY-POLICY>
            <LiNk href=/entry.js REL=MODULEPRELOAD>
            <link href=/keep.css rel=StyleSheet>
            <link href="https://example.com/touch.png" rel="ICON apple-touch-icon">
            <meta content="https://example.com/tile.png" NAME=MSAPPLICATION-TILEIMAGE>
            <title>Archive</title></head>`),
          byteLength: 200,
          contentType: "text/html; charset=utf-8",
        }),
    } as unknown as ObjectStore

    const response = await createArticleAccess({ store, objects }).replay(
      "owner-1",
      "article-1"
    )
    const policy = response.headers.get("Content-Security-Policy")

    expect(policy).toContain("sandbox allow-same-origin")
    expect(policy).toContain("script-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-ancestors 'self'")
    const html = await response.text()
    expect(html).not.toMatch(
      /frame-ancestors|modulepreload|touch\.png|tile\.png/i
    )
    expect(html).toContain("/keep.css")
  })
})
