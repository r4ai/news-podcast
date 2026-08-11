import { Skeleton } from "@workspace/ui/components/skeleton"

/** パイプライン処理待ちの間に表示するskeleton。 */
export function MarkdownSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3" role="status">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
