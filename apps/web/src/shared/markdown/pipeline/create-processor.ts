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

import { markdownComponents } from "../components"
import { rehypeMarkCodeBlocks } from "./rehype-mark-code-blocks"
import { rehypeMermaid } from "./rehype-mermaid"
import { rehypeResolveUrls } from "./rehype-resolve-urls"
import { remarkCallout } from "./remark-callout"
import { remarkCodeMeta } from "./remark-code-meta"
import { markdownSanitizeSchema } from "./sanitize-schema"
import { rehypeShikiLazy } from "./shiki/rehype-shiki-lazy"

/**
 * remark/rehypeパイプラインの組み立て。順序が重要:
 * sanitizeはKaTeX/ShikiがHTMLを追加する前段に置く(そうしないと、
 * Shikiが出す大量の `<span style>` がsanitizeで落とされてしまう)。
 * mermaidの図判定・block/inline codeの判定はShikiの後、React変換の前に
 * 行う。
 */
export function createMarkdownProcessor(baseUrl: string | undefined) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCallout)
    .use(remarkMath)
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
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
