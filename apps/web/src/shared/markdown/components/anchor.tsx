import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

function isExternal(href: string | undefined): boolean {
  return href !== undefined && /^https?:\/\//i.test(href)
}

/** 外部リンクだけ新規タブで開き、`rel="noreferrer"` でreferrerを渡さない。 */
export function Anchor({
  className,
  href,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const external = isExternal(href)
  return (
    <a
      className={cn(
        "font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground",
        className
      )}
      href={href}
      rel={external ? "noreferrer" : props.rel}
      target={external ? "_blank" : props.target}
      {...props}
    />
  )
}
