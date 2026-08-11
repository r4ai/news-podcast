import type { Element, Root } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

import { resolveMarkdownUrl } from "../lib/resolve-url"

/**
 * アーカイブ本文の相対URL(画像の `assets/{hash}` など)を `baseUrl` 起点の
 * 絶対URLに解決するrehypeプラグイン。rehype-rawの後、sanitizeの前に置く。
 */
export function rehypeResolveUrls(
  baseUrl: string | undefined
): Plugin<[], Root> {
  return () => (tree: Root) => {
    if (!baseUrl) {
      return
    }
    visit(tree, "element", (node: Element) => {
      resolveProperty(node, "img", "src", baseUrl)
      resolveProperty(node, "source", "src", baseUrl)
    })
  }
}

function resolveProperty(
  node: Element,
  tagName: string,
  property: "src",
  baseUrl: string
): void {
  if (node.tagName !== tagName) {
    return
  }
  const current = node.properties[property]
  if (typeof current !== "string") {
    return
  }
  node.properties[property] = resolveMarkdownUrl(current, baseUrl)
}
