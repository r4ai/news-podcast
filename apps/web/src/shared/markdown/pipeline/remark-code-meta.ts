import type { Code, Root } from "mdast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

/**
 * fenceのmeta文字列(`title="x.sql" {1,3-5}`)を、mdastの`code.meta`から
 * hastの`properties.metastring`へ複製するremarkプラグイン。
 *
 * remark-rehypeは既定でmeta文字列を`data.meta`へ入れるが、`rehype-raw`は
 * HTML文字列を経由してツリーを再構築するため、hastの`data`(HTML表現を
 * 持たない情報)はここで失われる。`hProperties`経由で`properties`に
 * 載せておけば通常の属性として`rehype-raw`を生き延びる。
 * `@shikijs/rehype`の`PreHandler`は`properties.metastring`を
 * `data.meta`のfallbackとして読むため、この形にしておけばそのまま使える。
 */
export const remarkCodeMeta: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "code", (node: Code) => {
    if (!node.meta) {
      return
    }
    node.data = {
      ...node.data,
      hProperties: {
        ...(node.data?.hProperties as Record<string, unknown> | undefined),
        metastring: node.meta,
      },
    }
  })
}
