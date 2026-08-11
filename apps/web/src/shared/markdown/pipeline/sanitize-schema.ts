import type { Schema } from "hast-util-sanitize"
import { defaultSchema } from "rehype-sanitize"

/**
 * hast-util-sanitizeの既定スキーマを拡張する。
 * - callout用の独自要素 `markdown-callout` と `data-callout-type`
 * - remark-mathが生成する `math` / `math-inline` / `math-display` クラス
 * - Shikiがコード要素に付与する `language-*` クラス
 * - GFM脚注・タスクリストで必要な属性(既定スキーマに含まれる分は継承)
 *
 * Shiki自身の出力(色・行span)はsanitizeの後段で追加されるため、ここでは
 * 触れない。KaTeXの出力も同様にsanitizeの後段。
 *
 * `clobberPrefix` は既定で `"user-content-"` だが、remark-rehypeのGFM脚注
 * (`[^1]`)生成が既にそのprefixを付けたid/hrefを作るため、既定のまま重ねると
 * `user-content-user-content-fn-1` のように二重になる。ここでは空文字にして
 * 二重付与を避ける。
 */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "markdown-callout"],
  attributes: {
    ...defaultSchema.attributes,
    "markdown-callout": [["dataCalloutType"]],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./],
      // remark-code-metaがfenceのmeta文字列をここへ複製する(data.metaは
      // rehype-rawのreparseで失われるため)。@shikijs/rehypeがfallbackとして読む。
      "metastring",
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", "math-inline"],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "math-display"],
    ],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "alt",
      "title",
      "width",
      "height",
    ],
  },
}
