import { toString } from "hast-util-to-string"
import type { Element, Root, RootContent } from "hast"
import type { Plugin } from "unified"

/** 表記ゆれで一致を取り逃さないよう、空白と記号の差を無視して比べる。 */
function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[|｜–—―-]+/g, "")
    .toLowerCase()
}

function isHeading(node: RootContent): node is Element {
  return node.type === "element" && /^h[1-6]$/.test((node as Element).tagName)
}

/**
 * 本文の先頭が記事タイトルの再掲なら取り除く。
 *
 * リーダーは記事タイトルを自前の見出しとして必ず表示する。取得元ページの
 * 本文にも同じ見出しが入っていることが多く、そのまま描画すると同じ文言が
 * 二度並ぶ。判定は「先頭の意味のあるノードが見出しで、その文字列が
 * タイトルと一致する」場合だけに限り、本文中の見出しには触れない。
 */
export const rehypeDropLeadingTitle =
  (title: string | undefined): Plugin<[], Root> =>
  () =>
  (tree: Root) => {
    if (title === undefined || title.trim() === "") return
    const index = tree.children.findIndex(
      (node) => node.type !== "text" || node.value.trim() !== ""
    )
    const first = index === -1 ? undefined : tree.children[index]
    if (first === undefined || !isHeading(first)) return
    if (normalize(toString(first)) !== normalize(title)) return
    tree.children.splice(index, 1)
  }
