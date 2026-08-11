import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function InlineCode({
  className,
  ...props
}: ComponentPropsWithoutRef<"code">) {
  return (
    <code
      className={cn(
        "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground",
        className
      )}
      {...props}
    />
  )
}
