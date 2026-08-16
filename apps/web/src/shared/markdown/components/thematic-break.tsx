import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * `---`による主題の転換。shadcn/uiのSeparatorは`div role="separator"`を出すが、
 * 文書の区切りは`<hr>`が正しい意味論なので、色と余白だけを揃える。
 *
 * Tailwindのpreflightは`*`に`border: 0 solid`を当てるため、余白と枠色を
 * 明示しないと本文の中で線が浮くか消えるかのどちらかになる。
 */
export function ThematicBreak({
  className,
  ...props
}: ComponentPropsWithoutRef<"hr">) {
  return (
    <hr className={cn("my-8 h-px border-0 bg-border", className)} {...props} />
  )
}
