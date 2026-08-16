import "katex/dist/katex.min.css"

import { MarkdownError } from "./components/markdown-error"
import { MarkdownSkeleton } from "./components/markdown-skeleton"
import {
  useCompiledMarkdown,
  type MarkdownCompileState,
} from "./hooks/use-compiled-markdown"

export type MarkdownProps = {
  /** アーカイブ記事本文などのMarkdown文字列。 */
  readonly markdown: string
  /** 本文中の相対URL(画像など)を解決する起点URL。 */
  readonly baseUrl?: string
  /**
   * 本文の最も浅い見出しに与えるレベル。埋め込み先に既に見出しがある場合に
   * 指定し、ページ全体の見出し順が飛ばないようにする。
   */
  readonly headingBaseLevel?: number
  /** 先頭がこの文字列と同じ見出しなら、タイトルの再掲とみなして落とす。 */
  readonly omitLeadingTitle?: string
}

/**
 * コンパイル済みの状態を描き分けるだけのview(ADR-0018: hookが状態を持ち、
 * viewはpropsのみ)。目次のように本文の外へ置きたいものがある場合は、
 * 呼び出し側が`useCompiledMarkdown`を直接使い、その状態をここへ渡す。
 */
export function MarkdownBody({
  state,
}: {
  readonly state: MarkdownCompileState
}) {
  if (state.status === "loading") {
    return <MarkdownSkeleton />
  }
  if (state.status === "error") {
    return <MarkdownError message={state.message} />
  }
  return <div className="min-w-0">{state.content}</div>
}

/**
 * アーカイブ記事本文をremark/rehypeパイプラインで描画するルート
 * コンポーネント。ShikiとMermaidの読み込みが非同期なため、結果は
 * `useCompiledMarkdown`が持つ状態に従って出し分ける。
 */
export function Markdown({
  markdown,
  baseUrl,
  headingBaseLevel,
  omitLeadingTitle,
}: MarkdownProps) {
  const state = useCompiledMarkdown(markdown, {
    baseUrl,
    headingBaseLevel,
    omitLeadingTitle,
  })

  return <MarkdownBody state={state} />
}
