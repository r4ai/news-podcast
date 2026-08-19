import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Markdown } from "./markdown"
import { createMarkdownProcessor } from "./pipeline/create-processor"

async function renderMarkdown(markdown: string) {
  const view = render(<Markdown markdown={markdown} />)
  await waitFor(() =>
    expect(
      view.container.querySelector(
        "h1, p, table, pre, figure, img, iframe, a, .katex"
      )
    ).not.toBeNull()
  )
  return view
}

describe("Markdown", () => {
  it("renders headings, links and inline code", async () => {
    await renderMarkdown(
      "# 見出し\n\n本文 [リンク](https://example.com) `code` です。"
    )

    expect(
      screen.getByRole("heading", { level: 1, name: "見出し" })
    ).toBeTruthy()
    const link = screen.getByRole("link", { name: "リンク" })
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noreferrer")
  })

  it("renders GFM tables and task lists inside a scrollable container", async () => {
    const { container } = await renderMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo"
    )

    const tableWrapper = container.querySelector("table")?.parentElement
    expect(tableWrapper?.className).toContain("overflow-x-auto")
    const checkboxes = screen.getAllByRole("checkbox")
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0].getAttribute("aria-checked")).toBe("true")
    expect(checkboxes[1].getAttribute("aria-checked")).toBe("false")
  })

  it("draws the table outline once, on the wrapper only", async () => {
    const { container } = await renderMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |"
    )

    const table = container.querySelector("table")
    // 外周は角丸の入れ物だけが持つ。セルまで枠を持つと角丸のすぐ内側へ
    // もう一本線が並び、二重の枠に見えてしまう。
    const outline = table?.parentElement?.parentElement
    expect(outline?.className).toContain("rounded-md")
    expect(outline?.className).toContain("border")
    for (const cell of Array.from(container.querySelectorAll("th, td"))) {
      expect(cell.className).not.toMatch(/(^|\s)border(\s|$)/)
    }
  })

  it("renders a GitHub-alert callout with the matching role and type", async () => {
    await renderMarkdown("> [!WARNING]\n> 気をつけて。")

    const note = screen.getByRole("note")
    expect(note.textContent).toContain("気をつけて")
  })

  it("renders an expanded foldable callout type and preserves its title", async () => {
    const { container } = await renderMarkdown(
      "> [!bug]- Parser incident\n> Stack trace details"
    )

    const callout = screen.getByRole("note")
    expect(callout.textContent).toContain("Parser incident")
    expect(callout.textContent).toContain("Stack trace details")
    expect(container.querySelector("details:not([open])")).not.toBeNull()
  })

  it("shows a filename header and always-present line numbers for fenced code", async () => {
    const { container } = await renderMarkdown(
      '```sql title="migrations/0006_fts.sql"\nSELECT 1;\nSELECT 2;\n```'
    )

    expect(screen.getByText("migrations/0006_fts.sql")).toBeTruthy()
    expect(screen.getByRole("button", { name: "コードをコピー" })).toBeTruthy()
    const lineNumbers = Array.from(
      container.querySelectorAll("pre code > span")
    ).map((line) => line.querySelector("span")?.textContent)
    expect(lineNumbers).toEqual(["1", "2"])
  })

  it("honors converted line-number visibility and starting line metadata", async () => {
    const hidden = await renderMarkdown(
      "```ts showLineNumbers=false startLine=10\nconst a = 1\nconst b = 2\n```"
    )
    expect(
      hidden.container.querySelectorAll("[data-line-number]")
    ).toHaveLength(0)
    hidden.unmount()

    const shown = await renderMarkdown(
      "```ts showLineNumbers=true startLine=10\nconst a = 1\nconst b = 2\n```"
    )
    expect(
      Array.from(shown.container.querySelectorAll("[data-line-number]")).map(
        (node) => node.textContent
      )
    ).toEqual(["10", "11"])
  })

  it("loads allowlisted embeds in a sandbox and degrades unsafe providers", async () => {
    const safe = await renderMarkdown(
      '@[embed](https://www.youtube.com/embed/abc "https://youtu.be/abc")'
    )
    const frame = safe.container.querySelector("iframe")
    // プレイヤーはJSを要るが、`allow-same-origin`が無いのでiframeは一意な
    // オリジンのまま。自分でsandboxを外すことも親を触ることもできない。
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts")
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer")
    safe.unmount()

    await renderMarkdown(
      '@[embed](https://tracker.example/embed/abc "https://example.com/watch")'
    )
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://example.com/watch"
    )
  })

  it("falls back to plain rendering for an unknown/absent language without throwing", async () => {
    const { container } = await renderMarkdown("```\npnpm vitest run\n```")

    expect(container.textContent).toContain("pnpm vitest run")
  })

  it("keeps footnote ids from being clobber-prefixed twice", async () => {
    const { container } = await renderMarkdown(
      "本文に脚注[^1]を付ける。\n\n[^1]: 説明"
    )

    const backref = container.querySelector("[data-footnote-backref]")
    expect(backref?.getAttribute("href")).toBe("#user-content-fnref-1")
    expect(container.querySelector("#user-content-fn-1")).not.toBeNull()
  })

  it("does not nest figure/figcaption inside a paragraph for a captioned image", async () => {
    const { container } = await renderMarkdown(
      '![説明文](assets/x.png "図1 全体の流れ")'
    )

    const figure = container.querySelector("figure")
    expect(figure?.closest("p")).toBeNull()
    expect(figure?.querySelector("figcaption")?.textContent).toBe(
      "図1 全体の流れ"
    )
    // altは代替テキストのまま。キャプションへ転記しない。
    expect(figure?.querySelector("img")?.getAttribute("alt")).toBe("説明文")
  })

  it("keeps alt text out of the visible caption when there is no title", async () => {
    const { container } = await renderMarkdown("![説明文](assets/x.png)")

    expect(container.querySelector("figcaption")).toBeNull()
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("説明文")
  })

  it("does not style an image inside running text as a standalone figure", async () => {
    // リンクカードのfaviconのように文中へ埋め込まれた画像。図版として
    // 中央寄せ・枠付きにすると本文が崩れる。
    const { container } = await renderMarkdown(
      "以前[![](assets/favicon.png)前の記事](https://example.com/a)で書いた。"
    )

    const image = container.querySelector("img")
    expect(image?.className).not.toMatch(/\bmx-auto\b/)
    expect(image?.closest("figure")).toBeNull()
  })

  it("renders math via KaTeX", async () => {
    const { container } = await renderMarkdown("$O(n \\log n)$")

    expect(container.querySelector(".katex")).not.toBeNull()
  })

  it("falls back to a code block instead of crashing when mermaid cannot render", async () => {
    const { container } = await renderMarkdown(
      "```mermaid\ngraph TD;\nA-->B;\n```"
    )

    await waitFor(() =>
      expect(container.querySelector('[role="status"]')).toBeNull()
    )
    // jsdomにはCSSカスケードが無くtoken解決が失敗するため、常にフォールバック
    // 経路を通る。フォールバックがCodeBlockとして元のコードを表示することを
    // 確認する(実ブラウザでの成功描画パスはStorybookで確認する)。
    expect(container.textContent).toContain("graph TD;")
  })
})

describe("Markdown heading placement", () => {
  async function renderLeveled(props: {
    markdown: string
    headingBaseLevel?: number
    omitLeadingTitle?: string
  }) {
    const view = render(<Markdown {...props} />)
    await waitFor(() =>
      expect(
        view.container.querySelector("h1, h2, h3, h4, h5, h6, p")
      ).not.toBeNull()
    )
    return view
  }

  const levelsOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
      (node) => `${node.tagName.toLowerCase()}:${node.textContent}`
    )

  it("grafts the shallowest heading onto the requested level, keeping depth", async () => {
    const { container } = await renderLeveled({
      markdown: "# 章\n\n本文\n\n## 節\n\n本文\n\n### 項\n\n本文",
      headingBaseLevel: 3,
    })

    expect(levelsOf(container)).toEqual(["h3:章", "h4:節", "h5:項"])
  })

  it("lifts a body that starts deeper than the requested level", async () => {
    const { container } = await renderLeveled({
      markdown: "### 章\n\n本文\n\n#### 節\n\n本文",
      headingBaseLevel: 2,
    })

    expect(levelsOf(container)).toEqual(["h2:章", "h3:節"])
  })

  it("never pushes a heading past h6", async () => {
    const { container } = await renderLeveled({
      markdown: "# 章\n\n本文\n\n###### 最深\n\n本文",
      headingBaseLevel: 3,
    })

    expect(levelsOf(container)).toEqual(["h3:章", "h6:最深"])
  })

  it("keeps headings untouched when no level is requested", async () => {
    const { container } = await renderLeveled({ markdown: "# 章\n\n本文" })

    expect(levelsOf(container)).toEqual(["h1:章"])
  })

  it("drops a leading heading that repeats the title, without leaving a gap", async () => {
    const { container } = await renderLeveled({
      markdown: "# React 19 の並行機能\n\n本文です。\n\n## 節\n\n本文",
      headingBaseLevel: 3,
      omitLeadingTitle: "React 19の並行機能",
    })

    // 再掲を落とすと最浅がh2になるので、そのh2がh3へ来る。段が飛ばない。
    expect(container.textContent).not.toContain("React 19 の並行機能")
    expect(levelsOf(container)).toEqual(["h3:節"])
  })

  it("keeps a leading heading that differs from the title", async () => {
    const { container } = await renderLeveled({
      markdown: "# 別の見出し\n\n本文です。",
      headingBaseLevel: 3,
      omitLeadingTitle: "React 19の並行機能",
    })

    expect(levelsOf(container)).toEqual(["h3:別の見出し"])
  })

  it("keeps a matching heading that is not at the very start", async () => {
    const { container } = await renderLeveled({
      markdown: "本文です。\n\n# React 19の並行機能\n\nつづき。",
      headingBaseLevel: 3,
      omitLeadingTitle: "React 19の並行機能",
    })

    expect(levelsOf(container)).toEqual(["h3:React 19の並行機能"])
  })
})

describe("Markdown heading anchors", () => {
  async function renderOutline(markdown: string) {
    const view = render(<Markdown headingBaseLevel={3} markdown={markdown} />)
    await waitFor(() =>
      expect(view.container.querySelector("h3, h4, p")).not.toBeNull()
    )
    return view
  }

  it("gives every heading a stable id derived from its text", async () => {
    const { container } = await renderOutline("# Getting Started\n\n## 設計")

    expect(container.querySelector("#getting-started")).not.toBeNull()
    expect(container.querySelector("#設計")).not.toBeNull()
  })

  it("numbers repeated headings so ids stay unique", async () => {
    const { container } = await renderOutline("# Setup\n\n本文\n\n# Setup")

    expect(container.querySelector("#setup")).not.toBeNull()
    expect(container.querySelector("#setup-1")).not.toBeNull()
  })

  it("keeps the anchor out of the heading's accessible name", async () => {
    await renderOutline("# 見出し")

    // 見出しの中のリンクはアクセシブル名へ混ざる。名前が「見出し」のままである
    // ことが、読み上げが二重にならないことの担保になる。
    expect(
      screen.getByRole("heading", { level: 3, name: "見出し" })
    ).toBeTruthy()
  })

  it("does not expose the anchor as a focusable link", async () => {
    const { container } = await renderOutline("# 見出し")

    const anchor = container.querySelector("h3 a")
    expect(anchor?.getAttribute("aria-hidden")).toBe("true")
    expect(anchor?.getAttribute("tabindex")).toBe("-1")
    expect(anchor?.getAttribute("href")).toBe(
      `#${encodeURIComponent("見出し")}`
    )
  })
})

describe("heading outline", () => {
  async function outlineOf(markdown: string, headingBaseLevel = 3) {
    const file = await createMarkdownProcessor({ headingBaseLevel }).process(
      markdown
    )
    return (file.data.outline ?? []) as readonly { text: string; id: string }[]
  }

  it("collects the headings in document order with their ids", async () => {
    expect(await outlineOf("# 章\n\n本文\n\n## 節")).toEqual([
      { id: "章", level: 3, text: "章" },
      { id: "節", level: 4, text: "節" },
    ])
  })

  it("leaves the GFM footnote label out of the outline", async () => {
    // 脚注は`<section data-footnotes>`の中に`sr-only`の「Footnotes」見出しを
    // 作る。目に見えない見出しが目次へ並ぶと、本文の構造と食い違う。
    expect(
      (await outlineOf("# 章\n\n本文[^1]\n\n[^1]: 脚注")).map(
        (entry) => entry.text
      )
    ).toEqual(["章"])
  })
})

describe("source footer", () => {
  const sourceUrl = "https://example.com/articles/a"

  it("turns the converter's trailing Source line into a footer", async () => {
    const { container } = await renderMarkdown(
      `本文。\n\nSource: <${sourceUrl}>`
    )

    const footer = container.querySelector("footer")
    expect(footer?.textContent).toContain("出典:")
    const link = footer?.querySelector("a")
    expect(link?.getAttribute("href")).toBe(sourceUrl)
    expect(link?.getAttribute("target")).toBe("_blank")
    // 裸のURL段落として本文に残らない。
    expect(container.querySelector("p")?.textContent).toBe("本文。")
  })

  it("leaves a prose paragraph that merely starts with Source alone", async () => {
    const { container } = await renderMarkdown(
      "Source: [参考文献](https://example.com/ref) を参照。"
    )

    expect(container.querySelector("footer")).toBeNull()
    expect(container.querySelector("p")?.textContent).toContain("を参照。")
  })

  it("leaves a Source line that is not the last block alone", async () => {
    const { container } = await renderMarkdown(
      `Source: <${sourceUrl}>\n\nあとがき。`
    )

    expect(container.querySelector("footer")).toBeNull()
  })
})
