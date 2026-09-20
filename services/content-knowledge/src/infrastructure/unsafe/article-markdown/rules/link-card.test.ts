import { describe, expect, it } from "vitest"
import { createArticleArchiveArtifacts } from "../index.js"

// card + metadata -> enriched card; missing/failed metadata -> original link;
// repeated URL -> one lookup; inline links / embeds -> no metadata lookup.
describe("archived link card metadata", () => {
  it("preserves metadata only for cards and deduplicates URLs", async () => {
    const urls: string[] = []
    const result = await createArticleArchiveArtifacts(
      '<article><a class="link-card" href="https://example.com/card">card</a><a class="link-card" href="https://example.com/card">again</a><p><a href="https://example.com/plain">plain</a></p></article>',
      "https://example.com/article",
      {
        resolveLinkCard: async (url) => {
          urls.push(url)
          return {
            title: 'A "title"',
            description: "A summary",
            image: "https://example.com/image.png",
          }
        },
      }
    )
    expect(urls).toEqual(["https://example.com/card"])
    expect(new TextDecoder().decode(result.markdown)).toContain("link-card:v1:")
    expect(result.diagnostics.appliedRules).toContain("link-card-metadata")
  })
  it("keeps unavailable metadata optional", async () => {
    for (const resolveLinkCard of [
      async () => undefined,
      async () => {
        throw Error("offline")
      },
    ]) {
      const result = await createArticleArchiveArtifacts(
        '<article><a class="link-card" href="https://example.com/card">card</a></article>',
        "https://example.com/article",
        { resolveLinkCard }
      )
      expect(new TextDecoder().decode(result.markdown)).toContain(
        "@[card](https://example.com/card)"
      )
    }
  })
})

it("bounds lookups to the first twelve URLs and three concurrent requests", async () => {
  const urls: string[] = []
  let active = 0
  let peak = 0
  await createArticleArchiveArtifacts(
    `<article>${Array.from({ length: 15 }, (_, i) => `<a class="link-card" href="https://example.com/${i}">card</a>`).join("")}</article>`,
    "https://example.com/article",
    {
      resolveLinkCard: async (url) => {
        urls.push(url)
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        active--
        return { title: url }
      },
    }
  )
  expect(urls).toEqual(
    Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`)
  )
  expect(peak).toBe(3)
})
