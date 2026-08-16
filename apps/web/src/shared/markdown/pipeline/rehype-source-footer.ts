import type { Element, Root, RootContent } from "hast"
import type { Plugin } from "unified"

/**
 * 変換器が本文末尾へ必ず足す`Source: <url>`段落を、出典フッターへ置き換える。
 *
 * 変換器(`core/pipeline.ts`の`appendSource`)は「テキスト`Source: `」と
 * 「URLを表示文言に持つリンク」の2要素だけの段落を末尾へ足す。そのままだと
 * 本文の最後に長い裸のURLが1行あるだけになり、本文の一部なのか出典なのかが
 * 見た目から分からない。
 *
 * 判定は本文全体の走査ではなく**末尾の1要素**に限り、形も上の2要素に厳密に
 * 一致する場合だけ置き換える。本文中に偶然現れた「Source:」で始まる段落を
 * 壊さないため。sanitizeの後に置くので、独自要素をschemaへ足す必要はない。
 */
export const rehypeSourceFooter: Plugin<[], Root> = () => (tree: Root) => {
  const index = lastElementIndex(tree.children)
  if (index === undefined) return

  const node = tree.children[index] as Element
  const url = sourceUrlOf(node)
  if (url === undefined) return

  tree.children[index] = {
    type: "element",
    tagName: "markdown-source",
    properties: { dataSourceUrl: url },
    children: [],
  }
}

function lastElementIndex(
  children: readonly RootContent[]
): number | undefined {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child?.type === "element") return index
    // 改行などの空白テキストは飛ばす。
    if (child?.type === "text" && child.value.trim() === "") continue
    return undefined
  }
  return undefined
}

function sourceUrlOf(node: Element): string | undefined {
  if (node.tagName !== "p" || node.children.length !== 2) return undefined
  const [label, anchor] = node.children
  if (label?.type !== "text" || label.value !== "Source: ") return undefined
  if (anchor?.type !== "element" || anchor.tagName !== "a") return undefined

  const href = anchor.properties.href
  if (typeof href !== "string") return undefined
  const [text] = anchor.children
  // 表示文言がURLそのものであること。人が書いた「Source: 参考文献」は残す。
  if (text?.type !== "text" || text.value !== href) return undefined
  return href
}
