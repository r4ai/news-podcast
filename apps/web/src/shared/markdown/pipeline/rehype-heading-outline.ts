import type { Element, Root } from "hast"
import { toString } from "hast-util-to-string"
import type { Plugin } from "unified"
import { SKIP, visit } from "unist-util-visit"
import type { VFile } from "vfile"

import { uniqueSlug } from "../lib/slug"

export type HeadingOutlineEntry = Readonly<{
  readonly id: string
  readonly level: number
  readonly text: string
}>

const HEADING = /^h([1-6])$/

/**
 * 見出しにアンカー用のidを振り、目次のために見出しの並びを`file.data.outline`
 * へ集める。
 *
 * sanitizeとレベル調整(`rehype-heading-levels`)の後に置く。前に置くと、
 * 接ぎ木で変わる前のレベルを拾ってしまい、目次の階層が本文とずれる。
 * 既にidを持つ見出し(生HTML由来)はそのidを尊重する。
 */
export const rehypeHeadingOutline: Plugin<[], Root> =
  () => (tree: Root, file: VFile) => {
    const outline: HeadingOutlineEntry[] = []
    const seen = new Map<string, number>()

    visit(tree, "element", (node: Element) => {
      // GFM脚注のセクションは、本文の節ではなく参照の置き場。中の
      // 「Footnotes」見出しは`sr-only`で目にも見えないので、目次にも載せない。
      if (
        node.tagName === "section" &&
        node.properties.dataFootnotes !== undefined
      ) {
        return SKIP
      }
      const match = HEADING.exec(node.tagName)
      if (!match) return

      const text = toString(node)
      const existing = node.properties.id
      const id =
        typeof existing === "string" && existing !== ""
          ? existing
          : uniqueSlug(text, seen)
      node.properties.id = id
      outline.push({ id, level: Number(match[1]), text })
    })

    file.data.outline = outline
  }
