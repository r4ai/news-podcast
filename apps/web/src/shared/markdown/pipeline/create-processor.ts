import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import rehypeReact from "rehype-react"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { unified } from "unified"
import remarkCallout from "@r4ai/remark-callout"
import type { Callout as ParsedCallout } from "@r4ai/remark-callout"

import { markdownComponents } from "../components"
import { rehypeDropLeadingTitle } from "./rehype-drop-leading-title"
import { rehypeHeadingLevels } from "./rehype-heading-levels"
import { rehypeMarkCodeBlocks } from "./rehype-mark-code-blocks"

import { rehypeMermaid } from "./rehype-mermaid"
import { rehypeResolveUrls } from "./rehype-resolve-urls"
import { remarkCodeMeta } from "./remark-code-meta"
import { remarkEmbedDirective } from "./remark-embed-directive"
import { markdownSanitizeSchema } from "./sanitize-schema"
import { rehypeShikiLazy } from "./shiki/rehype-shiki-lazy"

export type MarkdownProcessorOptions = {
  /** 本文中の相対URL(画像など)を解決する起点URL。 */
  readonly baseUrl?: string
  /**
   * 本文の最も浅い見出しに与えるレベル。埋め込み先に既に見出しがある時に
   * 指定する。例: ページh1 + 記事タイトルh2 の下へ差し込むなら`3`。
   */
  readonly headingBaseLevel?: number
  /** 先頭がこの文字列と同じ見出しなら、タイトルの再掲とみなして落とす。 */
  readonly omitLeadingTitle?: string
}

/**
 * remark/rehypeパイプラインの組み立て。順序が重要:
 * sanitizeはKaTeX/ShikiがHTMLを追加する前段に置く(そうしないと、
 * Shikiが出す大量の `<span style>` がsanitizeで落とされてしまう)。
 * 見出しの除去とレベル調整はsanitize直後、装飾が入る前に済ませる。
 * mermaidの図判定・block/inline codeの判定はShikiの後、React変換の前に
 * 行う。
 */
export function createMarkdownProcessor({
  baseUrl,
  headingBaseLevel,
  omitLeadingTitle,
}: MarkdownProcessorOptions) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCallout, {
      root: (callout: ParsedCallout) => ({
        tagName: callout.isFoldable
          ? "markdown-callout-foldable"
          : "markdown-callout",
        properties: {
          dataCalloutType: callout.type,
          ...(callout.isFoldable
            ? { dataCalloutFolded: callout.defaultFolded ?? false }
            : {}),
        },
      }),
      title: (callout: ParsedCallout) => ({
        tagName: callout.isFoldable ? "summary" : "div",
        properties: { dataCalloutTitle: true },
      }),
      body: { tagName: "div", properties: { dataCalloutBody: true } },
    })
    .use(remarkEmbedDirective)
    .use(remarkMath)
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeDropLeadingTitle(omitLeadingTitle))
    .use(rehypeHeadingLevels(headingBaseLevel))
    .use(rehypeResolveUrls(baseUrl))
    .use(rehypeKatex)
    .use(rehypeShikiLazy)
    .use(rehypeMermaid)
    .use(rehypeMarkCodeBlocks)
    .use(rehypeReact, {
      Fragment,
      jsx,
      jsxs,
      components: markdownComponents,
    })
}
