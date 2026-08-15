import rehypeShikiFromHighlighter from "@shikijs/rehype/core"
import type { Element, Root } from "hast"
import type { Plugin } from "unified"
import type { VFile } from "vfile"
import { visit } from "unist-util-visit"

import { extractCodeDisplayMeta } from "../../lib/line-ranges"
import {
  DARK_THEME,
  ensureLanguageLoaded,
  getHighlighter,
  LIGHT_THEME,
} from "./highlighter"
import { notationDiffTransformer, rawSourceTransformer } from "./transformers"

/** mermaidは図として描画するため、シンタックスハイライト対象から除外する。 */
const SKIP_LANGUAGES = new Set(["mermaid"])

/**
 * fenceのmeta文字列 (`title="x.ts" {1,3-5}`) を解釈し、`<pre>` 要素へ
 * 自動シリアライズされるmetaオブジェクトへ変換する。
 */
function parseMetaString(metaString: string) {
  return extractCodeDisplayMeta(metaString)
}

function collectLanguages(tree: Root): ReadonlySet<string> {
  const languages = new Set<string>()
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "code") {
      return
    }
    const lang = languageOf(node)
    if (lang && !SKIP_LANGUAGES.has(lang)) {
      languages.add(lang)
    }
  })
  return languages
}

function languageOf(codeNode: Element): string | undefined {
  const classes = codeNode.properties.className
  const list = Array.isArray(classes) ? classes : []
  const languageClass = list.find(
    (value) => typeof value === "string" && value.startsWith("language-")
  )
  return typeof languageClass === "string"
    ? languageClass.slice("language-".length)
    : undefined
}

/**
 * 本文中で使われている言語だけを遅延importしてから、Shikiでハイライトする
 * rehypeプラグイン。sanitizeの後、KaTeXの前に置く。
 */
export const rehypeShikiLazy: Plugin<[], Root> =
  () => async (tree: Root, file: VFile) => {
    const languages = collectLanguages(tree)
    await Promise.all([...languages].map((lang) => ensureLanguageLoaded(lang)))
    const highlighter = await getHighlighter()
    // createHighlighterCoreはHighlighterCoreを返すが、@shikijs/rehype/coreの
    // 引数型はHighlighterGeneric固定。実行時互換なのでここで型だけ合わせる。
    const transform = rehypeShikiFromHighlighter(
      highlighter as unknown as Parameters<
        typeof rehypeShikiFromHighlighter
      >[0],
      {
        themes: { light: LIGHT_THEME, dark: DARK_THEME },
        defaultColor: false,
        // CodeBlock側で言語名を出す/diffLineKindの`lang==="diff"`判定に使うため、
        // Shikiが処理した`<code>`にも`language-xxx`クラスを残す。
        addLanguageClass: true,
        parseMetaString,
        transformers: [notationDiffTransformer, rawSourceTransformer],
      }
    )
    await transform(tree, file, () => {})
  }
