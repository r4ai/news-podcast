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

/**
 * 見出しレベルごとに階層を可読にする、装飾を足さないタイポグラフィ。
 *
 * `id`があるとき(= `rehype-heading-outline`が振ったとき)は、その見出しへの
 * リンクを添える。
 *
 * アンカーは支援技術から隠す。見出しの中に置いたリンクは見出しのアクセシブル名
 * へ混ざり、「見出し この見出しへのリンク」のように読み上げが二重になる。
 * キーボードと支援技術から見出しへ飛ぶ経路は目次(`MarkdownToc`)が持つので、
 * ここは目で見つけて右クリックやコピーをするためのマウス向けの導線に徹する。
 * `#`もテキストノードではなく`::after`で描き、本文のテキスト抽出を汚さない。
 */
export function Heading({
  level,
  className,
  children,
  id,
  ...props
}: HeadingProps) {
  const Tag = `h${level}` as ElementType
  return (
    <Tag
      className={cn("group/heading", LEVEL_CLASS[level], className)}
      id={id}
      {...props}
    >
      {children}
      {id ? (
        <a
          aria-hidden="true"
          className="ml-2 text-muted-foreground no-underline opacity-0 transition-opacity after:content-['#'] group-hover/heading:opacity-100"
          href={`#${encodeURIComponent(id)}`}
          tabIndex={-1}
        />
      ) : null}
    </Tag>
  )
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
