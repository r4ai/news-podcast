import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

/** `<details>` 生HTML(折りたたみ)を neutral UI のトーンへ合わせる。 */
export function Details({
  className,
  ...props
}: ComponentPropsWithoutRef<"details">) {
  return (
    <details
      className={cn(
        "my-4 rounded-md border border-border px-4 py-3",
        className
      )}
      {...props}
    />
  )
}

export function Summary({
  className,
  ...props
}: ComponentPropsWithoutRef<"summary">) {
  return (
    <summary
      className={cn(
        "cursor-pointer font-medium text-foreground select-none",
        className
      )}
      {...props}
    />
  )
}
