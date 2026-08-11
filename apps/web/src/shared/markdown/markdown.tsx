import "katex/dist/katex.min.css"

import { MarkdownError } from "./components/markdown-error"
import { MarkdownSkeleton } from "./components/markdown-skeleton"
import { useCompiledMarkdown } from "./hooks/use-compiled-markdown"

export type MarkdownProps = {
  /** アーカイブ記事本文などのMarkdown文字列。 */
  readonly markdown: string
  /** 本文中の相対URL(画像など)を解決する起点URL。 */
  readonly baseUrl?: string
}

/**
 * アーカイブ記事本文をremark/rehypeパイプラインで描画するルート
 * コンポーネント。ShikiとMermaidの読み込みが非同期なため、結果は
 * `useCompiledMarkdown`が持つ状態(ADR-0018: hookが状態を持ち、viewは
 * propsのみ)に従って出し分ける。
 */
export function Markdown({ markdown, baseUrl }: MarkdownProps) {
  const state = useCompiledMarkdown(markdown, baseUrl)

  if (state.status === "loading") {
    return <MarkdownSkeleton />
  }
  if (state.status === "error") {
    return <MarkdownError message={state.message} />
  }
  return <div className="min-w-0">{state.content}</div>
}
