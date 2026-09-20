import type { Root as MarkdownRoot } from "mdast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

/** Mark missing titles before remark-callout supplies its default label. */
export const remarkMarkUntitledCallouts: Plugin<[], MarkdownRoot> =
  () => (tree: MarkdownRoot) => {
    visit(tree, "blockquote", (node) => {
      const paragraph = node.children[0]
      const text =
        paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
      if (
        text?.type !== "text" ||
        !/^\[![^\]]+\]$/.test(text.value.split("\n")[0]!)
      )
        return
      // Inline nodes on the marker line are an authored title, even when
      // the first text node consists only of the marker.
      if (
        !text.value.includes("\n") &&
        paragraph?.type === "paragraph" &&
        paragraph.children
          .slice(1)
          .some(
            (child) =>
              child.type !== "break" &&
              child.position?.start.line === text.position?.start.line &&
              (child.type !== "text" ||
                Boolean(child.value.split("\n")[0]?.trim()))
          )
      )
        return
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, dataCalloutUntitled: true },
      }
    })
  }
