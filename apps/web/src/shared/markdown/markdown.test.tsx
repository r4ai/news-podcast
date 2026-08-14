import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Markdown } from "./markdown"

async function renderMarkdown(markdown: string) {
  const view = render(<Markdown markdown={markdown} />)
  await waitFor(() =>
    expect(
      view.container.querySelector("h1, p, table, pre, figure, .katex")
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

  it("renders a GitHub-alert callout with the matching role and type", async () => {
    await renderMarkdown("> [!WARNING]\n> 気をつけて。")

    const note = screen.getByRole("note")
    expect(note.textContent).toContain("気をつけて")
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
    const { container } = await renderMarkdown("![説明文](assets/x.png)")

    const figure = container.querySelector("figure")
    expect(figure?.closest("p")).toBeNull()
    expect(figure?.querySelector("figcaption")?.textContent).toBe("説明文")
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
