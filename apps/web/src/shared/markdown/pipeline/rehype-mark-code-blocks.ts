import type { Element, Root } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

/**
 * `<code>` がfenced code block由来(親が`<pre>`)かinline codeかを、
 * rehype-react段階のcomponentマッピングで判別できるよう印を付ける。
 * `components/code.tsx` の `Code` がこの `isBlock` を見て、CodeBlockと
 * InlineCodeのどちらの見た目にするか決める。
 */
export const rehypeMarkCodeBlocks: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "element", (node: Element, _index, parent) => {
    if (node.tagName !== "code" || !parent || parent.type !== "element") {
      return
    }
    if (parent.tagName === "pre") {
      node.properties.isBlock = true
    }
  })
}
