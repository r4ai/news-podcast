import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

/** ページ本体を横スクロールさせないよう、tableだけをoverflow-x-autoで包む。 */
export function Table({
  className,
  ...props
}: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="my-4 w-full overflow-x-auto rounded-md border border-border">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  )
}

export function TableHead({
  className,
  ...props
}: ComponentPropsWithoutRef<"thead">) {
  return <thead className={cn("bg-muted", className)} {...props} />
}

export function TableRow({
  className,
  ...props
}: ComponentPropsWithoutRef<"tr">) {
  return (
    <tr
      className={cn("border-b border-border last:border-0", className)}
      {...props}
    />
  )
}

export function TableHeaderCell({
  className,
  ...props
}: ComponentPropsWithoutRef<"th">) {
  return (
    <th
      className={cn(
        "border border-border px-3 py-2 text-left font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  ...props
}: ComponentPropsWithoutRef<"td">) {
  return (
    <td
      className={cn("border border-border px-3 py-2", className)}
      {...props}
    />
  )
}
