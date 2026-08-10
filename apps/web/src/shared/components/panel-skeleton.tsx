import { Skeleton } from "@workspace/ui/components/skeleton"

export function PanelSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-3 rounded-xl border p-4"
      role="status"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-8 w-28" />
    </div>
  )
}
