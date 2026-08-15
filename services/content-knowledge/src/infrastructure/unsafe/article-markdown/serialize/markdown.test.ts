import { describe, expect, it } from "vitest"

import { resolveArticleUrls } from "../rules/document.js"
import {
  parseArticleHtml,
  sanitizeArticleHast,
  stringifyMarkdown,
  toMarkdownTree,
} from "./markdown.js"

const convert = (html: string): string => {
  const tree = sanitizeArticleHast(parseArticleHtml(html))
  resolveArticleUrls(tree, new URL("https://example.com/a/"))
  return stringifyMarkdown(toMarkdownTree(tree))
}

describe("HAST to Markdown serialization", () => {
  it("keeps safe code metadata, language and nested text", () => {
    expect(
      convert(
        '<pre data-article-code-meta="title=&quot;x.ts&quot;"><code class="language-ts"><span>a</span>b</code></pre>'
      )
    ).toBe('```ts title="x.ts"\nab\n```\n')
  })

  it("handles code without metadata/language and inline code", () => {
    expect(
      convert(
        '<pre data-article-code-meta=""><code>x</code></pre><p><code>y</code></p>'
      )
    ).toBe("```\nx\n```\n\n`y`\n")
  })

  it("serializes display/inline math and safe/empty links", () => {
    expect(
      convert(
        '<code class="language-math"><span>x</span><!--ignored-->^2</code><p><code class="language-math-inline">a+b</code> <a href="/ok">ok</a> <a href="javascript:x">bad</a></p>'
      )
    ).toContain("$$\nx^2\n$$")
    const markdown = convert(
      '<p><code class="language-math-inline">a+b</code> <a href="/ok">ok</a> <a href="javascript:x">bad</a></p>'
    )
    expect(markdown).toContain("$a+b$")
    expect(markdown).toContain("[ok](https://example.com/ok)")
    expect(markdown).toContain("[bad]()")
    expect(
      stringifyMarkdown(
        toMarkdownTree(
          parseArticleHtml('<code class="language-math"><!--comment-->z</code>')
        )
      )
    ).toContain("z")
  })

  it("preserves callout markers while leaving ordinary escapes untouched", () => {
    const markdown = convert(
      "<blockquote><p>[!BUG]- title</p><p>body</p></blockquote><p>[ordinary]</p>"
    )
    expect(markdown).toContain("> [!BUG]- title")
    expect(markdown).toContain("\\[ordinary]")
  })
})
