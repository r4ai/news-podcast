import { describe, expect, it } from "vitest"

import { createArticleArchiveArtifacts } from "./article-markdown-parser.js"

const sourceUrl = "https://news.example.com/articles/1"

const markdownOf = async (html: string, url = sourceUrl): Promise<string> =>
  new TextDecoder().decode(
    (await createArticleArchiveArtifacts(new TextEncoder().encode(html), url))
      .markdown
  )

/** `## Title`が`# Title`を含んでしまうので、見出しは行そのもので比較する。 */
const headingsOf = async (html: string): Promise<readonly string[]> =>
  (await markdownOf(html)).split("\n").filter((line) => /^#{1,6} /.test(line))

/**
 * 保存するMarkdownは「取得元ページの断片」であり、埋め込み先の見出し階層は
 * 保存時点では分からない。そこで見出しは相対関係だけを保った正規形へ畳み、
 * 実際のレベルは表示側が決められるようにする。
 */
describe("article markdown heading normalization", () => {
  it("lifts the shallowest heading to level 1 while keeping relative depth", async () => {
    expect(
      await headingsOf(
        "<h2>Title</h2><p>Intro</p><h3>Section</h3><p>Body</p><h4>Detail</h4><p>More</p>"
      )
    ).toEqual(["# Title", "## Section", "### Detail"])
  })

  it("leaves an already normalized document untouched", async () => {
    expect(
      await headingsOf("<h1>Title</h1><h2>Section</h2><p>Body</p>")
    ).toEqual(["# Title", "## Section"])
  })

  it("keeps sibling headings distinguishable when a level is skipped", async () => {
    expect(
      await headingsOf(
        "<h3>Title</h3><p>a</p><h5>Deep</h5><p>b</p><h3>Next</h3><p>c</p>"
      )
    ).toEqual(["# Title", "### Deep", "# Next"])
  })

  it("clamps a shift that would push a heading past level 6", async () => {
    // h1..h6のうち最浅がh1なら移動しない。深い側が6を超えないことだけを守る。
    expect(await headingsOf("<h5>Title</h5><h6>Deep</h6><p>body</p>")).toEqual([
      "# Title",
      "## Deep",
    ])
  })

  it("does not invent a heading for a document that has none", async () => {
    const markdown = await markdownOf("<p>Just a paragraph</p>")
    expect(await headingsOf("<p>Just a paragraph</p>")).toEqual([])
    expect(markdown).toContain("Just a paragraph")
  })
})

describe("article markdown site profiles", () => {
  it("uses the Zenn root while reusing shared code and callout conversion", async () => {
    const markdown = await markdownOf(
      `<nav>Site navigation</nav>
       <main><article class="znc">
         <h2>Zenn article</h2>
         <aside class="msg alert"><div class="msg-content"><p>Dangerous operation</p></div></aside>
         <div class="code-block-container">
           <div class="code-block-filename">src/example.ts</div>
           <pre class="shiki"><code><span class="line">const answer = 42</span></code></pre>
         </div>
       </article></main>`,
      "https://zenn.dev/example/articles/parser"
    )

    expect(markdown).not.toContain("Site navigation")
    expect(markdown).toContain("> [!warning]")
    expect(markdown).toContain('```ts title="src/example.ts"')
    expect(markdown).toContain("const answer = 42")
  })

  it("uses the Qiita root and preserves explicit code language and note meaning", async () => {
    const markdown = await markdownOf(
      `<header>Qiita header</header>
       <article id="personal-public-article-body" class="it-MdContent">
         <h1>Qiita article</h1>
         <div class="note alert"><p>Do not run this</p></div>
         <div class="code-frame" data-lang="ruby">
           <div class="code-lang">script.rb</div>
           <div class="highlight"><pre><code>puts :ok</code></pre></div>
         </div>
       </article>`,
      "https://qiita.com/example/items/abc"
    )

    expect(markdown).not.toContain("Qiita header")
    expect(markdown).toContain("> [!danger]")
    expect(markdown).toContain('```ruby title="script.rb"')
  })

  it("falls back to generic article extraction for unknown sites", async () => {
    const markdown = await markdownOf(
      `<body><nav>Global navigation</nav><article><h1>Readable title</h1><p>${"Substantial article body. ".repeat(20)}</p></article></body>`,
      "https://blog.example.com/post"
    )

    expect(markdown).toContain("Readable title")
    expect(markdown).not.toContain("Global navigation")
  })
})
