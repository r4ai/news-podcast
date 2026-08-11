import type { Blockquote, Paragraph, Root, Text } from "mdast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

import { matchCalloutMarker } from "../lib/callout"

/**
 * GitHub Alerts風の `> [!NOTE]` 記法を持つ blockquote を、
 * `<markdown-callout data-callout-type="note">` へ変換するremarkプラグイン。
 * remark-mathより前段で動かし、通常のblockquoteと衝突しないようにする。
 */
export const remarkCallout: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const marker = readMarker(node)
    if (!marker) {
      return
    }
    stripMarker(node, marker.rest)
    node.data = {
      ...node.data,
      hName: "markdown-callout",
      hProperties: { dataCalloutType: marker.type },
    }
  })
}

function readMarker(node: Blockquote) {
  const firstParagraph = node.children[0]
  if (!firstParagraph || firstParagraph.type !== "paragraph") {
    return undefined
  }
  const firstText = firstParagraph.children[0]
  if (!firstText || firstText.type !== "text") {
    return undefined
  }
  return matchCalloutMarker(firstText.value)
}

/** 標識文字列を取り除き、残りが空なら段落ごと削除する。 */
function stripMarker(node: Blockquote, rest: string): void {
  const paragraph = node.children[0] as Paragraph
  const firstText = paragraph.children[0] as Text
  const trimmedRest = rest.replace(/^\n/, "")
  if (trimmedRest === "") {
    paragraph.children.shift()
    if (paragraph.children.length === 0) {
      node.children.shift()
    }
    return
  }
  firstText.value = trimmedRest
}
