import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { Figure } from "./figure"

/**
 * `src` はrehype段階(baseUrl解決)で既に絶対URLになっている前提。
 * `alt` があるときはFigureでキャプション付きに包む。
 */
export function Image({
  alt,
  className,
  ...props
}: ComponentPropsWithoutRef<"img">) {
  const img = (
    <img
      alt={alt ?? ""}
      className={cn(
        "mx-auto h-auto max-w-full rounded-md border border-border",
        className
      )}
      loading="lazy"
      {...props}
    />
  )
  return alt ? <Figure caption={alt}>{img}</Figure> : img
}
