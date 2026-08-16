import type { Element, Root, RootContent } from "hast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

/** 空白だけのテキストは、段落の中身としては無いものとして扱う。 */
function isMeaningful(node: RootContent): boolean {
  return node.type !== "text" || node.value.trim() !== ""
}

/**
 * 画像が「独立した図版」なのか「本文中のインライン画像」なのかを、
 * rehype-react段階のcomponentマッピングで判別できるよう印を付ける。
 *
 * remarkは画像だけの行も`<p><img></p>`に包むので、タグだけを見ても両者を
 * 区別できない。実際の記事本文には、リンクカードのfaviconのように文中へ
 * 埋め込まれた小さな画像が現れる。これを図版として中央寄せ・枠付きにすると
 * 本文が崩れるため、段落の唯一の中身である場合だけ図版として扱う。
 *
 * `components/image.tsx` の `Image` がこの `isBlock` を見て見た目を決める。
 */
export const rehypeMarkBlockImages: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "p") return
    const children = node.children.filter(isMeaningful)
    const only = children[0]
    if (
      children.length === 1 &&
      only?.type === "element" &&
      only.tagName === "img"
    ) {
      only.properties.isBlock = true
    }
  })
}
