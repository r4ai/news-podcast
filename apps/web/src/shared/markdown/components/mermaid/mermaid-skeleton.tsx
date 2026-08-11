import { Skeleton } from "@workspace/ui/components/skeleton"

/** mermaidの動的import/描画待ちの間に表示するskeleton。 */
export function MermaidSkeleton() {
  return (
    <div
      aria-busy="true"
      className="my-6 flex flex-col items-center gap-2 rounded-md border border-border p-6"
      role="status"
    >
      <Skeleton className="h-32 w-full max-w-md" />
      <span className="text-xs text-muted-foreground">図を読み込み中…</span>
    </div>
  )
}
