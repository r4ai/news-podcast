import remarkParse from "remark-parse"
import { unified } from "unified"
import { describe, expect, it } from "vitest"
import type { Paragraph, Root } from "mdast"

import { remarkEmbedDirective } from "./remark-embed-directive"

const transform = (markdown: string): Paragraph => {
  const processor = unified().use(remarkParse).use(remarkEmbedDirective)
  const tree = processor.runSync(processor.parse(markdown)) as Root
  return tree.children[0] as Paragraph
}

describe("embed directive syntax", () => {
  it("converts embed and card links with deterministic fallback", () => {
    expect(
      transform('@[embed](https://x.test/embed "https://x.test/watch")').data
    ).toMatchObject({
      hName: "markdown-embed",
      hProperties: {
        dataEmbedUrl: "https://x.test/embed",
        dataEmbedFallback: "https://x.test/watch",
      },
    })
    expect(transform("@[card](https://x.test/article)").data).toMatchObject({
      hName: "markdown-link-card",
      hProperties: {
        dataEmbedFallback: "https://x.test/article",
      },
    })
  })

  it.each([
    "ordinary text",
    "[embed](https://x.test)",
    "@[other](https://x.test)",
    "@[**embed**](https://x.test)",
    "@[embed](https://x.test) trailing",
  ])("leaves unsupported shape unchanged: %s", (markdown) => {
    expect(transform(markdown).data?.hName).toBeUndefined()
  })
})
