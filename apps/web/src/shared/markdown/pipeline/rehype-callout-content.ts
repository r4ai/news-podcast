import type { Root, Element } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

/** Remove parser artifacts, not authored content or punctuation. */
export const rehypeCalloutContent: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (node.properties.dataCalloutUntitled !== undefined) {
      node.children = node.children.filter(
        (child) =>
          !(
            child.type === "element" &&
            child.properties.dataCalloutTitle !== undefined
          )
      )
    }
    if (node.properties.dataCalloutBody !== undefined) {
      while (node.children.length) {
        const first = node.children[0]!
        const whitespace = first.type === "text" && !first.value.trim()
        const emptyParagraph =
          first.type === "element" &&
          first.tagName === "p" &&
          first.children.every(
            (child) => child.type === "text" && !child.value.trim()
          )
        if (!whitespace && !emptyParagraph) break
        node.children.shift()
      }
    }
  })
}
