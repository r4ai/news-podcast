import type { Nodes, Parent, RootContent } from "mdast"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"

import remarkCallout from "@r4ai/remark-callout"

/**
 * Markdownから、一覧行に出せる平文の1行を取り出す。
 *
 * 正規表現でMarkdownを剥がすと、リンクの入れ子や画像、callout記法、コード
 * ブロックの扱いを取りこぼす(ADR-0042: 構造を正規表現で解釈しない)。ここでは
 * 本文の描画と同じremarkでparseし、mdastを歩いて可視テキストだけを集める。
 *
 * 描画パイプライン(`create-processor.ts`)とは別に軽い構成にしているのは、
 * 一覧の行ごとにShiki・KaTeX・Mermaidの遅延importを走らせるわけにはいかない
 * ため。ここで要るのは「文字を取り出す」ことだけなので、hastへ変換しない。
 */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // calloutを通しておかないと `[!note]` がそのまま文字として出る。
  .use(remarkCallout)
  .use(remarkMath)

/** 行の要約として意味を持たないブロック。飛ばして次の候補へ進む。 */
const SKIPPED_BLOCKS = new Set([
  "code",
  "heading",
  "html",
  "thematicBreak",
  "definition",
  "footnoteDefinition",
  "yaml",
])

/** 読み上げても意味の無い、もしくは文章の一部にならないノード。 */
const SKIPPED_INLINE = new Set([
  "image",
  "imageReference",
  "inlineMath",
  "math",
])

function hasChildren(node: Nodes): node is Parent & Nodes {
  return "children" in node && Array.isArray(node.children)
}

/**
 * calloutの見出し行。`> [!note]` だけの行から remark-callout が "Note" という
 * ラベルを組み立てるが、スニペットに欲しいのは本文の方。
 */
function isCalloutTitle(node: Nodes): boolean {
  const properties = node.data?.hProperties as
    | Record<string, unknown>
    | undefined
  return properties?.dataCalloutTitle === true
}

function collectText(node: Nodes): string {
  if (SKIPPED_INLINE.has(node.type)) return ""
  if (node.type === "text" || node.type === "inlineCode") return node.value
  if (node.type === "break") return " "
  if (!hasChildren(node)) return ""
  return node.children.map((child) => collectText(child)).join("")
}

/** 段落・リスト項目・引用など、文章として読める最初のブロックを探す。 */
function findFirstProse(nodes: readonly RootContent[]): string {
  for (const node of nodes) {
    if (SKIPPED_BLOCKS.has(node.type) || isCalloutTitle(node)) continue
    const text =
      node.type === "paragraph"
        ? collectText(node)
        : hasChildren(node)
          ? findFirstProse(node.children as readonly RootContent[])
          : ""
    const normalized = text.replace(/\s+/g, " ").trim()
    if (normalized.length > 0) return normalized
  }
  return ""
}

/**
 * 一覧行に出す1行。`maximumLength`で切り詰める(既定は既存の挙動と同じ200)。
 */
export function toPlainSnippet(markdown: string, maximumLength = 200): string {
  const tree = parser.parse(markdown)
  const transformed = parser.runSync(tree)
  return findFirstProse(transformed.children).slice(0, maximumLength)
}
