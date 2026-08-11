import { TriangleAlert } from "lucide-react"

import { CodeBlock } from "../code-block/code-block"

/**
 * 構文エラーで描画できなかったmermaidの図を、元のコードのまま
 * コードブロックとして表示する。CodeBlockはfenced code blockの
 * `<pre>`が受け取るのと同じ形の`children`(`<code>`要素1つ)を
 * 前提にしているため、ここでもその形に合わせて渡す。
 */
export function MermaidFallback({
  code,
  message,
}: {
  readonly code: string
  readonly message: string
}) {
  return (
    <div className="my-6">
      <p className="mb-2 flex items-center gap-1.5 text-sm text-destructive">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        図を解析できませんでした({message})。コードのまま表示しています。
      </p>
      <CodeBlock title="mermaid">
        <code>{code}</code>
      </CodeBlock>
    </div>
  )
}
