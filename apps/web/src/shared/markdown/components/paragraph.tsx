import { Children, isValidElement, type ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { Image } from "./image"

/**
 * remarkは画像だけの行も `<p><img></p>` に包む。Imageは`alt`があると
 * `<figure><figcaption>` を出すため、そのまま `<p>` に包むと
 * `<p>` の中に `<figure>`/`<figcaption>` が入る不正なHTMLになる。
 * 段落の中身がImage 1つだけのときは `<p>` を使わずそのまま返す。
 */
function isSoleImage(children: ComponentPropsWithoutRef<"p">["children"]) {
  const items = Children.toArray(children)
  return (
    items.length === 1 && isValidElement(items[0]) && items[0].type === Image
  )
}

export function Paragraph({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  if (isSoleImage(children)) {
    return <div className={cn("my-4", className)}>{children}</div>
  }
  return (
    <p
      className={cn("leading-7 [&:not(:first-child)]:mt-4", className)}
      {...props}
    >
      {children}
    </p>
  )
}
