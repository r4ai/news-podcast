import type { Components } from "hast-util-to-jsx-runtime"

import { Anchor } from "./anchor"
import { Blockquote } from "./blockquote"
import { Callout } from "./callout"
import { CodeBlock } from "./code-block/code-block"
import { Code } from "./code"
import { Details, Summary } from "./details"
import { Image } from "./image"
import { H1, H2, H3, H4, H5, H6 } from "./heading"
import { ListItem, OrderedList, UnorderedList } from "./list"
import { Mermaid } from "./mermaid/mermaid"
import { Paragraph } from "./paragraph"
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "./table"

/**
 * rehype-reactの `components` へ渡すhastタグ⇄Reactコンポーネントの対応表。
 * `markdown-callout` / `markdown-mermaid` は独自要素で、remark-callout /
 * rehype-mermaidがそれぞれ生成する。
 */
export const markdownComponents: Partial<Components> = {
  a: Anchor,
  blockquote: Blockquote,
  code: Code,
  details: Details,
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  h5: H5,
  h6: H6,
  img: Image,
  li: ListItem,
  ol: OrderedList,
  p: Paragraph,
  pre: CodeBlock,
  summary: Summary,
  table: Table,
  td: TableCell,
  th: TableHeaderCell,
  thead: TableHead,
  tr: TableRow,
  ul: UnorderedList,
  "markdown-callout": Callout,
  "markdown-mermaid": Mermaid,
}
