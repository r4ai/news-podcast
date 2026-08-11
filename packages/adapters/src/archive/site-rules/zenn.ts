import type { SiteRule } from "./types.js"

/**
 * Zenn (zenn.dev) 固有対応。
 *
 * 実記事のHTMLをWebFetch/curlで確認して判明した構造:
 * - 本文は `.znc` を持つ要素（記事本文とコメント欄の両方に付くが、本文が先に出現する）。
 * - コードブロックはshikiでハイライト済みのため `<pre class="shiki ...">` に言語クラスが無い。
 *   ファイル名付きブロックのみ `.code-block-filename` に拡張子つきファイル名が入るので、
 *   そこから言語を推測できる。
 * - メッセージ・警告ボックスは `<aside class="msg message">` / `<aside class="msg alert">` で、
 *   先頭に装飾用の `<span class="msg-symbol">` が入る。クラス名に "message"/"alert" を含むため
 *   html-to-markdown.ts 側の汎用callout変換がそのまま拾える。
 * - `:::details` はふつうの `<details><summary>` に変換される。
 * - リンクカード/GitHub埋め込みはiframeで表示されるが、直後に
 *   `<a href="..." style="display:none">実URL</a>` という非表示のフォールバックリンクが
 *   必ず併記される。iframeの `src` は `embed.zenn.studio` 経由のプロキシURLで実体を指さないため、
 *   このフォールバックリンクを使うのが確実。
 * - mermaid埋め込みだけはフォールバックリンクが無く、iframeの `data-content` にmermaid記法の
 *   ソースがURLエンコードされて入っている。
 */
export const zennSiteRule: SiteRule = {
  id: "zenn",

  matches(url) {
    return url.hostname === "zenn.dev"
  },

  prepare(document) {
    normalizeEmbedBlocks(document)
  },

  selectContent(document) {
    // コメント欄にも`.znc`が付くが、記事本文が常に先に出現する。
    return document.querySelector(".znc")
  },

  turndownRules: {
    zennCodeBlock: {
      filter: (node) =>
        node.nodeName === "DIV" &&
        node.classList.contains("code-block-container"),
      replacement: (_content, node, options) => {
        const code = node.querySelector("pre code")
        if (!code) return ""
        const filename = node
          .querySelector(".code-block-filename")
          ?.textContent?.trim()
        const language = filename ? languageFromFilename(filename) : ""
        const header = filename ? `${language} title="${filename}"` : language
        const fence = options.fence ?? "```"
        const text = (code.textContent ?? "").replace(/\n$/, "")
        return `\n\n${fence}${header}\n${text}\n${fence}\n\n`
      },
    },
  },
}

/** Zennの埋め込み(リンクカード/GitHub/mermaid)を復元可能な形へ畳み込む。 */
function normalizeEmbedBlocks(document: Document): void {
  document.querySelectorAll("span.embed-block").forEach((block) => {
    const iframe = block.querySelector("iframe")
    if (block.classList.contains("zenn-embedded-mermaid") && iframe) {
      replaceMermaidEmbed(document, block, iframe)
      return
    }
    const fallback = block.nextElementSibling
    if (isHiddenFallbackLink(fallback)) {
      fallback.removeAttribute("style")
      block.remove()
      return
    }
    // 復元手段が無い埋め込みは、素のiframeとしてhtml-to-markdown.tsの汎用処理に委ねる。
    unwrapEmbedBlock(block)
  })
}

function replaceMermaidEmbed(
  document: Document,
  block: Element,
  iframe: Element
): void {
  const raw = iframe.getAttribute("data-content") ?? ""
  const graph = decodeURIComponent(raw)
  const pre = document.createElement("pre")
  const code = document.createElement("code")
  code.className = "language-mermaid"
  code.textContent = graph
  pre.appendChild(code)
  block.replaceWith(pre)
}

function isHiddenFallbackLink(element: Element | null): element is Element {
  return (
    element?.tagName === "A" &&
    (element.getAttribute("style") ?? "").includes("display:none")
  )
}

function unwrapEmbedBlock(block: Element): void {
  const parent = block.parentNode
  if (!parent) return
  while (block.firstChild) parent.insertBefore(block.firstChild, block)
  block.remove()
}

/** ファイル名の拡張子からフェンス言語を推測する。判定できなければ空文字。 */
function languageFromFilename(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename)
  return match?.[1]?.toLowerCase() ?? ""
}
