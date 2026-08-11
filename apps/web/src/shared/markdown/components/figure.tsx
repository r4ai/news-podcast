import type { ReactNode } from "react"

export function Figure({
  caption,
  children,
}: {
  readonly caption?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <figure className="my-6">
      {children}
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
