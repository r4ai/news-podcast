import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Blockquote({
  className,
  ...props
}: ComponentPropsWithoutRef<"blockquote">) {
  return (
    <blockquote
      className={cn(
        "my-4 border-l-2 border-border pl-4 text-muted-foreground italic",
        className
      )}
      {...props}
    />
  )
}
