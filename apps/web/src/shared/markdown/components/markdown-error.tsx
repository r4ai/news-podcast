import { TriangleAlert } from "lucide-react"

/** Markdown解析自体が失敗したときの表示。個別ブロックのフォールバックとは別。 */
export function MarkdownError({ message }: { readonly message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      role="alert"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>本文を表示できませんでした({message})。</p>
    </div>
  )
}
