import { describe, expect, it } from "vitest"

import { createArticleArchiveArtifacts } from "./article-markdown-parser.js"

const sourceUrl = "https://news.example.com/articles/1"

const markdownOf = (html: string): string =>
  new TextDecoder().decode(
    createArticleArchiveArtifacts(new TextEncoder().encode(html), sourceUrl)
      .markdown
  )

/** `## Title`が`# Title`を含んでしまうので、見出しは行そのもので比較する。 */
const headingsOf = (html: string): readonly string[] =>
  markdownOf(html)
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))

/**
 * 保存するMarkdownは「取得元ページの断片」であり、埋め込み先の見出し階層は
 * 保存時点では分からない。そこで見出しは相対関係だけを保った正規形へ畳み、
 * 実際のレベルは表示側が決められるようにする。
 */
describe("article markdown heading normalization", () => {
  it("lifts the shallowest heading to level 1 while keeping relative depth", () => {
    expect(
      headingsOf(
        "<h2>Title</h2><p>Intro</p><h3>Section</h3><p>Body</p><h4>Detail</h4><p>More</p>"
      )
    ).toEqual(["# Title", "## Section", "### Detail"])
  })

  it("leaves an already normalized document untouched", () => {
    expect(headingsOf("<h1>Title</h1><h2>Section</h2><p>Body</p>")).toEqual([
      "# Title",
      "## Section",
    ])
  })

  it("keeps sibling headings distinguishable when a level is skipped", () => {
    expect(
      headingsOf(
        "<h3>Title</h3><p>a</p><h5>Deep</h5><p>b</p><h3>Next</h3><p>c</p>"
      )
    ).toEqual(["# Title", "### Deep", "# Next"])
  })

  it("clamps a shift that would push a heading past level 6", () => {
    // h1..h6のうち最浅がh1なら移動しない。深い側が6を超えないことだけを守る。
    expect(headingsOf("<h5>Title</h5><h6>Deep</h6><p>body</p>")).toEqual([
      "# Title",
      "## Deep",
    ])
  })

  it("does not invent a heading for a document that has none", () => {
    const markdown = markdownOf("<p>Just a paragraph</p>")
    expect(headingsOf("<p>Just a paragraph</p>")).toEqual([])
    expect(markdown).toContain("Just a paragraph")
  })
})
