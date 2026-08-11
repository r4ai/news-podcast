import type { Element, Root } from "hast"
import { toString } from "hast-util-to-string"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

const MERMAID_LANGUAGE_CLASS = "language-mermaid"

/**
 * `pre > code.language-mermaid` を、rehype-react側でMermaidコンポーネント
 * へ直接マッピングできる独自要素 `markdown-mermaid` へ変換する。
 * Shikiはmermaidをハイライト対象から除外している(`SKIP_LANGUAGES`)ので、
 * この段階ではまだテキストがそのまま残っている。rehype-shiki-lazyの後、
 * rehype-reactの前に置く。
 */
export const rehypeMermaid: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "element", (node: Element, index, parent) => {
    if (node.tagName !== "pre" || !parent || index === undefined) {
      return
    }
    const code = firstCodeChild(node)
    if (!code || !hasMermaidClass(code)) {
      return
    }
    const mermaidNode: Element = {
      type: "element",
      tagName: "markdown-mermaid",
      properties: { code: toString(code) },
      children: [],
    }
    parent.children[index] = mermaidNode
  })
}

function firstCodeChild(node: Element): Element | undefined {
  const child = node.children[0]
  return child?.type === "element" && child.tagName === "code"
    ? child
    : undefined
}

function hasMermaidClass(code: Element): boolean {
  const classes = code.properties.className
  return Array.isArray(classes) && classes.includes(MERMAID_LANGUAGE_CLASS)
}
