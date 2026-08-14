import type { Element, Root } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

const MAXIMUM_HEADING_LEVEL = 6

function headingLevel(node: Element): number | undefined {
  return /^h[1-6]$/.test(node.tagName)
    ? Number(node.tagName.slice(1))
    : undefined
}

/**
 * 本文の見出しを、埋め込み先の階層へ接ぎ木する。
 *
 * `baseLevel`は「本文の最も浅い見出しを何レベルにするか」。固定のオフセットで
 * はなく到達点で指定するのは、直前の工程(タイトル再掲の除去)で最浅レベルが
 * 変わり得るためで、オフセット指定だと見出し順に穴が空く。
 *
 * 相対関係を保つため全体を同じ量だけ動かし、`h6`より深くはしない。
 */
export const rehypeHeadingLevels =
  (baseLevel: number | undefined): Plugin<[], Root> =>
  () =>
  (tree: Root) => {
    if (baseLevel === undefined) return

    let shallowest = MAXIMUM_HEADING_LEVEL + 1
    visit(tree, "element", (node: Element) => {
      const level = headingLevel(node)
      if (level !== undefined) shallowest = Math.min(shallowest, level)
    })
    if (shallowest > MAXIMUM_HEADING_LEVEL) return

    const shift = baseLevel - shallowest
    if (shift === 0) return
    visit(tree, "element", (node: Element) => {
      const level = headingLevel(node)
      if (level === undefined) return
      node.tagName = `h${Math.min(Math.max(level + shift, 1), MAXIMUM_HEADING_LEVEL)}`
    })
  }
