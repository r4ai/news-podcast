import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"
import { gfm } from "./turndown-gfm.js"

import { resolveSiteRule } from "./site-rules/index.js"
import type { SiteRule } from "./site-rules/types.js"

type ArchiveDocument = ReturnType<typeof parseHTML>["document"]
type ReadabilityArticle = ReturnType<Readability["parse"]>

/**
 * アーカイブ済みHTMLをMarkdownへ変換する。
 *
 * 入力は正規化とasset捕獲を終えたHTML文字列を想定する。リンクは絶対URL、画像は
 * `assets/{hash}` の相対URLになっている前提で、この関数はURLを解決し直さない。
 * Readabilityは渡したDOMを破壊するため、必ず文字列から新しくparseする。
 */
export function htmlToMarkdown(html: string, sourceUrl: string): string {
  const { document } = parseHTML(html)
  const url = new URL(sourceUrl)
  const siteRule = resolveSiteRule(url)

  // サイト固有の下ごしらえ（例: Zennの埋め込み）を先に行い、その後に汎用の正規化をかける。
  // 汎用正規化はReadabilityが問答無用で消す要素（aside/iframeなど）を、
  // Readability実行前に安全な形へ畳み込むために必要。
  siteRule?.prepare?.(document as unknown as Document, url)
  normalizeCallouts(document)
  normalizeFootnotes(document)
  normalizeEmbeds(document)
  normalizeTaskLists(document)
  normalizeCodeBlocks(document)

  const selected =
    siteRule?.selectContent?.(document as unknown as Document, url) ?? null
  const article = selected
    ? null
    : new Readability(document as unknown as Document, {
        charThreshold: 0,
        // 既定ではコード言語クラス(language-xxx)ごとclassが剥がされてしまうため保持する。
        keepClasses: true,
      }).parse()

  const title = resolveTitle(document, article, url)
  const byline = article?.byline?.trim()
  const rawContent = resolveContentHtml(selected, article, document)
  const content = stripDuplicateTitle(rawContent, title)

  const turndown = buildTurndownService(siteRule)
  return [
    `# ${title}`,
    byline ? `\n- Author: ${byline}` : "",
    `\n- Source: ${sourceUrl}`,
    `\n${turndown.turndown(content).trim()}\n`,
  ].join("")
}

function resolveTitle(
  document: ArchiveDocument,
  article: ReadabilityArticle,
  url: URL
): string {
  return (
    article?.title?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    url.hostname
  )
}

function resolveContentHtml(
  selected: Element | null,
  article: ReadabilityArticle,
  document: ArchiveDocument
): string {
  if (selected) return selected.innerHTML
  return article?.content || document.body.innerHTML
}

/**
 * 本文先頭の見出しがタイトルと実質同じ内容なら、見出し二重表示になるため落とす。
 * Readabilityは記事の`<h1>`を本文に残す一方、呼び出し側は既にタイトルを別途見出しとして
 * 付けているため、そのままだと同じ見出しが二回出てしまう。
 */
function stripDuplicateTitle(contentHtml: string, title: string): string {
  const { document: fragment } = parseHTML(
    `<div id="archive-root">${contentHtml}</div>`
  )
  const root = fragment.getElementById("archive-root")
  const first = firstContentElement(root)
  // Readabilityは記事の`<h1>`を`<h2>`へ降格させることがあるため両方を見る。
  if (
    first &&
    (first.tagName === "H1" || first.tagName === "H2") &&
    normalizeForCompare(first.textContent) === normalizeForCompare(title)
  ) {
    first.remove()
  }
  return root?.innerHTML ?? contentHtml
}

/**
 * Readabilityは本文を`<div id="readability-page-1"><article>…`のように包むため、
 * 見出しに辿り着くまでラッパ要素を降りる。Calloutの容器に使う`<section>`は
 * ラッパ扱いしない（先頭がCalloutの記事で中身を誤判定しないため）。
 */
const CONTENT_WRAPPER_TAGS = new Set(["DIV", "ARTICLE", "MAIN"])

function firstContentElement(root: Element | null): Element | null {
  let current = root?.firstElementChild ?? null
  while (current && CONTENT_WRAPPER_TAGS.has(current.tagName))
    current = current.firstElementChild
  return current
}

function normalizeForCompare(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim()
}

const CALLOUT_KIND_BY_KEYWORD: Record<string, string> = {
  warning: "WARNING",
  caution: "CAUTION",
  danger: "CAUTION",
  note: "NOTE",
  info: "NOTE",
  message: "NOTE",
  tip: "TIP",
  important: "IMPORTANT",
  alert: "WARNING",
}

/** Callout容器に付ける印。Readabilityに消されない形で種別を運ぶ。 */
const CALLOUT_CLASS_PREFIX = "archive-callout-"

/**
 * `<aside>` や `blockquote.warning` 等のCallout記法に印を付ける。
 * Readabilityは`aside`を問答無用で除去するため、必ずReadability実行前に行う。
 *
 * 容器に`<section>`を使うのが要点。`<blockquote>`へ畳むとReadabilityの本文候補選定で
 * それ自体が勝ってしまい、記事本文が丸ごと失われる。`<div>`はclassごと展開されて印が消える。
 * `<section>`はkeepClasses付きなら中身もclassも保持される。
 */
function normalizeCallouts(document: ArchiveDocument): void {
  document.querySelectorAll("aside, blockquote").forEach((element: Element) => {
    const kind = calloutKind(Array.from(element.classList))
    if (!kind) return
    element
      .querySelectorAll('[class*="symbol" i]')
      .forEach((symbol: Element) => symbol.remove())
    const section = document.createElement("section")
    section.className = `${CALLOUT_CLASS_PREFIX}${kind.toLowerCase()}`
    while (element.firstChild) section.appendChild(element.firstChild)
    element.replaceWith(section)
  })
}

/** 印の付いたCallout容器から種別を読み出す。付いていなければundefined。 */
function calloutKindFromMarker(node: Element): string | undefined {
  for (const name of Array.from(node.classList)) {
    if (name.startsWith(CALLOUT_CLASS_PREFIX))
      return name.slice(CALLOUT_CLASS_PREFIX.length).toUpperCase()
  }
  return undefined
}

/** `archive-footnote-3` のようなclassから脚注番号を取り出す。 */
function footnoteIndex(node: Element): string {
  for (const name of Array.from(node.classList)) {
    const matched = /^archive-footnote-(\d+)$/.exec(name)
    if (matched) return matched[1] as string
  }
  return "1"
}

function calloutKind(classNames: readonly string[]): string | undefined {
  for (const name of classNames) {
    const kind = CALLOUT_KIND_BY_KEYWORD[name.toLowerCase()]
    if (kind) return kind
  }
  return undefined
}

const FOOTNOTE_ID_PATTERN = /^fn/i

/**
 * `<sup><a href="#fnN">`とその定義先`<li id="fnN">`という一般的な脚注マークアップを
 * GFM脚注記法（`[^N]`と`[^N]: ...`）に変換できる形へ正規化する。実際の文字列化は
 * turndownの追加ルール(buildTurndownService)側で行う。
 */
function normalizeFootnotes(document: ArchiveDocument): void {
  const definitions = collectFootnoteDefinitions(document)
  if (definitions.size === 0) return
  const indices = markFootnoteReferences(document, definitions)
  markFootnoteDefinitions(definitions, indices)
}

function collectFootnoteDefinitions(
  document: ArchiveDocument
): Map<string, Element> {
  const definitions = new Map<string, Element>()
  document.querySelectorAll("ol li[id], ul li[id]").forEach((li: Element) => {
    const id = li.getAttribute("id")
    if (id && FOOTNOTE_ID_PATTERN.test(id)) definitions.set(id, li)
  })
  return definitions
}

function markFootnoteReferences(
  document: ArchiveDocument,
  definitions: Map<string, Element>
): Map<string, number> {
  const indices = new Map<string, number>()
  document.querySelectorAll('a[href^="#"]').forEach((anchor: Element) => {
    const id = (anchor.getAttribute("href") ?? "").slice(1)
    if (!definitions.has(id)) return
    const index = indices.get(id) ?? indices.size + 1
    indices.set(id, index)
    const marker = document.createElement("span")
    // Readabilityは任意のdata-*属性を落とすため、番号もclassに載せて運ぶ。
    marker.className = `archive-footnote-ref archive-footnote-${index}`
    // 中身が空の要素はReadabilityに除去されるので、参照記法をそのまま入れておく。
    marker.textContent = `[^${index}]`
    const target = anchor.closest("sup") ?? anchor
    target.replaceWith(marker)
  })
  return indices
}

function markFootnoteDefinitions(
  definitions: Map<string, Element>,
  indices: Map<string, number>
): void {
  for (const [id, index] of indices) {
    const li = definitions.get(id)
    if (!li) continue
    // 定義側に残る「本文へ戻る」リンクはGFM脚注では不要なので削る。
    li.querySelectorAll('a[href^="#"]').forEach((backlink: Element) =>
      backlink.remove()
    )
    li.className = `archive-footnote-def archive-footnote-${index}`
  }
}

/**
 * Readabilityは`<input>`を除去するため、turndown-plugin-gfmのタスクリスト規則が
 * 走る頃にはチェック状態が失われている。Readability実行前にclassへ退避する。
 */
function normalizeTaskLists(document: ArchiveDocument): void {
  document
    .querySelectorAll('li input[type="checkbox"]')
    .forEach((input: Element) => {
      const item = input.closest("li")
      if (!item) return
      item.classList.add(
        input.hasAttribute("checked") ? "archive-task-done" : "archive-task"
      )
      input.remove()
    })
}

/** iframe埋め込みは痕跡なく消えてしまうため、リンクのプレースホルダへ落とす。 */
function normalizeEmbeds(document: ArchiveDocument): void {
  document.querySelectorAll("iframe").forEach((iframe: Element) => {
    const src = iframe.getAttribute("src")
    const label =
      iframe.getAttribute("title")?.trim() || src || "埋め込みコンテンツ"
    const paragraph = document.createElement("p")
    if (src) {
      const link = document.createElement("a")
      link.setAttribute("href", src)
      link.textContent = `埋め込み: ${label}`
      paragraph.appendChild(link)
    } else {
      paragraph.textContent = `埋め込み: ${label}`
    }
    iframe.replaceWith(paragraph)
  })
}

const CODE_FILENAME_SELECTOR = [
  '[class*="code-block-filename" i]',
  '[class~="filename" i]',
  "[data-filename]",
].join(",")

/**
 * Shiki/Prism/highlight.js系がHTMLへ残すクラスや属性を、Turndownが理解できる
 * `language-*` と `title` へ正規化する。ハイライト済みspanの見た目ではなく、
 * 生のtextContentをMarkdownへ戻すためサイトをまたいで利用できる。
 */
function normalizeCodeBlocks(document: ArchiveDocument): void {
  document.querySelectorAll("pre").forEach((pre: Element) => {
    const code = pre.querySelector("code")
    if (!code) return
    const container = codeContainer(pre)
    const filenameElement = container?.querySelector(CODE_FILENAME_SELECTOR)
    const filename =
      pre.getAttribute("data-filename")?.trim() ||
      code.getAttribute("data-filename")?.trim() ||
      filenameElement?.textContent?.trim() ||
      undefined
    const language =
      languageFromCodeElement(code) ??
      languageFromCodeElement(pre) ??
      (filename ? languageFromFilename(filename) : undefined)

    if (language) code.classList.add(`language-${language}`)
    if (filename) code.setAttribute("title", filename)
    pre.classList.add("archive-code-block")
    filenameElement?.remove()
  })
}

function codeContainer(pre: Element): Element | null {
  const parent = pre.parentElement
  if (!parent) return null
  return Array.from(parent.children).some(
    (child) => child !== pre && child.matches(CODE_FILENAME_SELECTOR)
  )
    ? parent
    : null
}

function languageFromCodeElement(element: Element): string | undefined {
  const attribute =
    element.getAttribute("data-language") ?? element.getAttribute("data-lang")
  if (attribute?.trim()) return normalizeCodeLanguage(attribute)

  const classes = Array.from(element.classList)
  for (const className of classes) {
    const match =
      /^(?:language|lang|highlight-source|brush)[-_:]([a-zA-Z0-9+#.-]+)$/.exec(
        className
      )
    if (match?.[1]) return normalizeCodeLanguage(match[1])
  }
  const brushIndex = classes.findIndex((name) => name === "brush:")
  return brushIndex >= 0 && classes[brushIndex + 1]
    ? normalizeCodeLanguage(classes[brushIndex + 1] as string)
    : undefined
}

function normalizeCodeLanguage(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#.-]/g, "")
}

function languageFromFilename(filename: string): string | undefined {
  return /\.([a-zA-Z0-9]+)$/.exec(filename)?.[1]?.toLowerCase()
}

function buildTurndownService(siteRule: SiteRule | undefined): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  })
  turndown.use(gfm)
  addOverrideRules(turndown)
  for (const [key, rule] of Object.entries(siteRule?.turndownRules ?? {})) {
    turndown.addRule(key, rule)
  }
  return turndown
}

function addOverrideRules(turndown: TurndownService): void {
  // turndown-plugin-gfmの打ち消し線はGFM非準拠の`~text~`を返すため上書きする。
  turndown.addRule("strikethrough", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  })
  turndown.addRule("callout", {
    filter: (node) =>
      node.nodeName === "SECTION" && Boolean(calloutKindFromMarker(node)),
    replacement: (content, node) => {
      const body = content
        .trim()
        .split("\n")
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n")
      return `\n\n> [!${calloutKindFromMarker(node)}]\n${body}\n\n`
    },
  })
  turndown.addRule("taskListItem", {
    filter: (node) =>
      node.nodeName === "LI" &&
      (node.classList.contains("archive-task") ||
        node.classList.contains("archive-task-done")),
    replacement: (content, node) => {
      const box = node.classList.contains("archive-task-done") ? "[x]" : "[ ]"
      const body = content.replace(/^\s+/, "").replace(/\n/g, "\n  ")
      return `- ${box} ${body}\n`
    },
  })
  turndown.addRule("footnoteRef", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.classList.contains("archive-footnote-ref"),
    replacement: (_content, node) => `[^${footnoteIndex(node)}]`,
  })
  turndown.addRule("footnoteDef", {
    filter: (node) =>
      node.nodeName === "LI" && node.classList.contains("archive-footnote-def"),
    replacement: (content, node) =>
      `\n[^${footnoteIndex(node)}]: ${content.trim()}\n`,
  })
  turndown.addRule("codeBlockMetadata", {
    filter: (node) =>
      node.nodeName === "PRE" && node.classList.contains("archive-code-block"),
    replacement: (_content, node, options) =>
      fencedCodeBlock(node.querySelector("code"), options.fence ?? "```"),
  })
  addMathRules(turndown)
  addDetailsRules(turndown)
}

function fencedCodeBlock(code: Element | null, fence: string): string {
  if (!code) return ""
  const language = Array.from(code.classList)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length)
  const filename = code.getAttribute("title")?.replaceAll('"', "&quot;")
  const metadata = [language, filename ? `title="${filename}"` : ""]
    .filter(Boolean)
    .join(" ")
  const text = (code.textContent ?? "").replace(/\n$/, "")
  return `\n\n${fence}${metadata}\n${text}\n${fence}\n\n`
}

/**
 * KaTeXの出力は視覚コピー(`.katex-html`)とTeXソース(`annotation`)を両方持つため、
 * 視覚コピーは捨ててTeXソースだけを`$...$`/`$$...$$`に変換する。
 * 通常のテキストノードはturndownが`[`や`\`をエスケープしてしまうため、
 * annotationの中身はreplacement関数から直接返して素通りさせる。
 */
function addMathRules(turndown: TurndownService): void {
  turndown.addRule("texMath", {
    filter: (node) =>
      node.nodeName.toLowerCase() === "annotation" &&
      node.getAttribute("encoding") === "application/x-tex",
    replacement: (_content, node) => {
      const tex = node.textContent ?? ""
      const isBlock = Boolean(node.closest(".katex-display"))
      return isBlock ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
    },
  })
  turndown.addRule("mathVisualCopy", {
    filter: (node) => node.classList.contains("katex-html"),
    replacement: () => "",
  })
}

/** `<details><summary>`はGFMに専用構文が無いため、生HTMLとして温存する。 */
function addDetailsRules(turndown: TurndownService): void {
  turndown.addRule("detailsSummary", {
    filter: "summary",
    replacement: () => "",
  })
  turndown.addRule("details", {
    filter: "details",
    replacement: (content, node) => {
      const summaryText =
        node.querySelector("summary")?.textContent?.trim() || "詳細"
      return `\n\n<details>\n<summary>${summaryText}</summary>\n\n${content.trim()}\n\n</details>\n\n`
    },
  })
}
