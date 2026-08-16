import { describe, expect, it } from "vitest"

import { toPlainSnippet } from "./to-plain-text"

describe("toPlainSnippet", () => {
  it("skips headings and code blocks to reach the first prose block", () => {
    expect(
      toPlainSnippet(
        "## 結論\nSuspenseで実装が簡潔になる。\n\n```mermaid\nflowchart LR\na-->b\n```"
      )
    ).toBe("Suspenseで実装が簡潔になる。")
  })

  it("keeps the text of emphasis, links and inline code", () => {
    expect(toPlainSnippet("- **要点1**\n- 要点2")).toBe("要点1")
    expect(toPlainSnippet("[リンク](https://example.com)")).toBe("リンク")
    expect(toPlainSnippet("`pnpm test` を実行する")).toBe(
      "pnpm test を実行する"
    )
  })

  it("keeps the label of a link whose text contains other markup", () => {
    // 正規表現でリンクを剥がしていた頃は、入れ子の記法で崩れていた。
    expect(
      toPlainSnippet("[**設計**の記事](https://example.com)を読んだ")
    ).toBe("設計の記事を読んだ")
  })

  it("drops images but keeps the surrounding sentence", () => {
    expect(
      toPlainSnippet(
        "以前[![](favicon.png)前の記事](https://example.com)で書いた"
      )
    ).toBe("以前前の記事で書いた")
  })

  it("does not leak callout markers", () => {
    expect(toPlainSnippet("> [!note]\n> 補足事項")).toBe("補足事項")
  })

  it("does not leak table pipes as prose", () => {
    expect(toPlainSnippet("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n本文")).toBe(
      "本文"
    )
  })

  it("skips a thematic break and a footnote definition", () => {
    expect(toPlainSnippet("---\n\n[^1]: 脚注\n\n本文")).toBe("本文")
  })

  it("collapses hard breaks and runs of whitespace into single spaces", () => {
    expect(toPlainSnippet("前半  \n後半")).toBe("前半 後半")
  })

  it("drops inline nodes that carry no readable text", () => {
    // インラインHTMLや脚注参照は葉ノードだが文字を持たない。
    expect(toPlainSnippet("前<br>後")).toBe("前後")
    expect(toPlainSnippet("本文[^1]\n\n[^1]: 脚注")).toBe("本文")
  })

  it("returns an empty string when there is no prose at all", () => {
    expect(toPlainSnippet("# 見出しだけ")).toBe("")
    expect(toPlainSnippet("")).toBe("")
  })

  it("caps the snippet at the requested length", () => {
    expect(toPlainSnippet("a".repeat(300)).length).toBe(200)
    expect(toPlainSnippet("a".repeat(300), 40).length).toBe(40)
  })
})
