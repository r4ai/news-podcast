import { render, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { markdownComponents } from "./components"
import { Markdown } from "./markdown"

/**
 * Content Knowledgeの変換器が実際に出力したMarkdown(golden corpus)を、実際の
 * パイプラインで描画して検証する。
 *
 * corpusは`pnpm markdown:corpus`が`services/content-knowledge`のfixtureから
 * 生成しcommitしている。手書きの近似fixtureだけで検証していると、保存Markdown
 * の実際の姿と描画側の想定が食い違っていても誰も気付けない。
 *
 * ここでは見た目ではなく「取りこぼしていないか」だけを見る。Shiki/KaTeX/Mermaid
 * の実際の絵はjsdomでは出ないので、それはStorybookの`Markdown/Corpus`で見る。
 */

const corpus = Object.entries(
  import.meta.glob("./__fixtures__/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>
)
  .map(([path, markdown]) => ({
    name: path.replace("./__fixtures__/", "").replace(/\.md$/, ""),
    markdown,
  }))
  .sort((left, right) => left.name.localeCompare(right.name))

/**
 * 描画結果に出てよいタグのうち、hastのタグ⇄Reactの対応表(`markdownComponents`)
 * に無いもの。ここに並ぶのは「素の要素のまま通す」か「自前componentが出す
 * 入れ物」のどちらかだという宣言であり、増える時は意図的でなければならない。
 */
const EXPECTED_UNMAPPED_TAGS = [
  "button", // CodeBlockのコピーボタン
  "circle", // lucideアイコン
  "div", // <Markdown>のmin-w-0ラッパと、各componentの入れ物
  "figcaption", // <Figure>
  "figure", // <Figure>
  "footer", // <SourceFooter>
  "iframe", // <Embed>
  "path", // lucideアイコン
  "rect", // lucideアイコン
  "span", // Shikiのトークン、KaTeX
  "style", // ShikiThemeStyle
  "svg", // lucideアイコン
] as const

async function renderCorpus(markdown: string) {
  const result = render(<Markdown headingBaseLevel={3} markdown={markdown} />)
  // Shikiの言語遅延importとMermaidの読み込みを挟むので、readyまで待つ。
  await waitFor(() =>
    expect(result.container.querySelector("[data-markdown-loading]")).toBeNull()
  )
  await waitFor(() =>
    expect(result.container.textContent?.length ?? 0).toBeGreaterThan(0)
  )
  return result
}

/** 描画結果から見える文字を、Markdown記法を含まない形で取り出す。 */
const visibleText = (container: HTMLElement) => container.textContent ?? ""

describe.each(corpus)("$name", ({ markdown }) => {
  it("renders without falling back to the error state", async () => {
    const { queryByRole } = await renderCorpus(markdown)
    expect(queryByRole("alert")).toBeNull()
  })

  it("leaves no dialect syntax as literal text", async () => {
    const { container } = await renderCorpus(markdown)
    const text = visibleText(container)

    // 変換器の方言がそのまま文字として出ていたら、描画側が取りこぼしている。
    for (const leak of [
      "[!",
      "@[embed](",
      "@[card](",
      "showLineNumbers=",
      'title="',
      "```",
      "$$",
    ]) {
      expect(
        text,
        `literal ${leak} leaked into the rendered text`
      ).not.toContain(leak)
    }
    // remark-stringifyのエスケープが復元されずに残っていないか。
    expect(text).not.toMatch(/\\[[\]&<>]/)
  })

  it("turns every fenced block into a code block or a diagram", async () => {
    const { container } = await renderCorpus(markdown)
    const fences = (markdown.match(/^```/gm)?.length ?? 0) / 2
    const blocks =
      container.querySelectorAll("pre").length +
      container.querySelectorAll("[data-mermaid]").length
    expect(blocks).toBe(fences)
  })

  it("turns every callout marker into a callout", async () => {
    const { container } = await renderCorpus(markdown)
    const markers = markdown.match(/^> \[!/gm)?.length ?? 0
    expect(container.querySelectorAll('[role="note"]').length).toBe(markers)
  })

  it("resolves every link and image to an absolute url", async () => {
    const { container } = await renderCorpus(markdown)
    for (const anchor of Array.from(container.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? ""
      // 脚注の参照だけはページ内アンカーで正しい。
      if (href.startsWith("#")) continue
      expect(href, `relative href: ${href}`).toMatch(/^https?:\/\//)
    }
    for (const image of Array.from(container.querySelectorAll("img[src]"))) {
      expect(image.getAttribute("src")).toMatch(/^https?:\/\//)
    }
  })

  it("grafts headings onto the host outline without skipping a level", async () => {
    const { container } = await renderCorpus(markdown)
    const levels = Array.from(
      container.querySelectorAll("h1,h2,h3,h4,h5,h6")
    ).map((heading) => Number(heading.tagName.slice(1)))
    if (levels.length === 0) return

    expect(Math.min(...levels), "shallowest heading should be the base").toBe(3)
    let previous = levels[0]!
    for (const level of levels) {
      expect(level, "heading levels must not skip").toBeLessThanOrEqual(
        previous + 1
      )
      previous = level
    }
  })

  it("uses a React component for every element it renders", async () => {
    const { container } = await renderCorpus(markdown)
    const mapped = new Set(Object.keys(markdownComponents))
    const rendered = new Set(
      Array.from(container.querySelectorAll("*")).map((element) =>
        element.tagName.toLowerCase()
      )
    )
    const unmapped = [...rendered]
      .filter((tag) => !mapped.has(tag))
      .filter((tag) => !EXPECTED_UNMAPPED_TAGS.includes(tag as never))
      .sort()

    expect(unmapped, "unstyled elements reached the page").toEqual([])
  })

  it("keeps inline images inline", async () => {
    const { container } = await renderCorpus(markdown)
    // 段落の途中に現れる画像(リンクカードのfaviconなど)を、独立した図版として
    // 中央寄せ・枠付きにしてしまうと本文が崩れる。
    for (const image of Array.from(
      container.querySelectorAll("p img, a img")
    )) {
      expect(
        image.className,
        `inline image styled as a block figure: ${image.getAttribute("src")}`
      ).not.toMatch(/\bmx-auto\b/)
      expect(image.closest("figure")).toBeNull()
    }
  })

  it("does not repeat alt text as a visible caption", async () => {
    const { container } = await renderCorpus(markdown)
    for (const caption of Array.from(
      container.querySelectorAll("figcaption")
    )) {
      const image = caption.closest("figure")?.querySelector("img")
      expect(
        caption.textContent,
        "alt text must stay in alt, not become a caption"
      ).not.toBe(image?.getAttribute("alt"))
    }
  })
})
