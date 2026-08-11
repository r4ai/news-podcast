import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function UnorderedList({
  className,
  ...props
}: ComponentPropsWithoutRef<"ul">) {
  return (
    <ul
      className={cn("my-4 ml-6 list-disc [&>li]:mt-1.5", className)}
      {...props}
    />
  )
}

export function OrderedList({
  className,
  ...props
}: ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn("my-4 ml-6 list-decimal [&>li]:mt-1.5", className)}
      {...props}
    />
  )
}

export function ListItem({
  className,
  ...props
}: ComponentPropsWithoutRef<"li">) {
  return <li className={cn("leading-7", className)} {...props} />
}
