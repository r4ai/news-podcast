import type { ComponentPropsWithoutRef, ElementType } from "react"

import { cn } from "@workspace/ui/lib/utils"

const LEVEL_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "mt-10 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0",
  2: "mt-8 mb-3 scroll-m-20 border-b border-border pb-1.5 text-2xl font-semibold tracking-tight first:mt-0",
  3: "mt-6 mb-2 scroll-m-20 text-xl font-semibold tracking-tight",
  4: "mt-5 mb-2 scroll-m-20 text-lg font-semibold tracking-tight",
  5: "mt-4 mb-1.5 scroll-m-20 text-base font-semibold tracking-tight",
  6: "mt-4 mb-1.5 scroll-m-20 text-sm font-semibold tracking-tight text-muted-foreground",
}

type HeadingProps = ComponentPropsWithoutRef<"h1"> & {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
}

/** 見出しレベルごとに階層を可読にする、装飾を足さないタイポグラフィ。 */
export function Heading({ level, className, ...props }: HeadingProps) {
  const Tag = `h${level}` as ElementType
  return <Tag className={cn(LEVEL_CLASS[level], className)} {...props} />
}

function makeHeading(level: HeadingProps["level"]) {
  return function BoundHeading(props: ComponentPropsWithoutRef<"h1">) {
    return <Heading level={level} {...props} />
  }
}

export const H1 = makeHeading(1)
export const H2 = makeHeading(2)
export const H3 = makeHeading(3)
export const H4 = makeHeading(4)
export const H5 = makeHeading(5)
export const H6 = makeHeading(6)
