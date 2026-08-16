import { cn } from "@workspace/ui/lib/utils"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

export type MarkdownTocProps = {
  readonly outline: readonly HeadingOutlineEntry[]
  /** 現在読んでいる見出しのid。`useActiveHeading`が求める。 */
  readonly activeId?: string
  readonly className?: string
  readonly label?: string
}

/** 深い見出しまで並べると目次が本文より長くなるので、2階層までにする。 */
const MAXIMUM_DEPTH = 2

/** 1件だけの目次は行き先が1つしかなく、案内にならない。 */
const MINIMUM_ENTRIES = 2

const INDENT_CLASS = ["pl-0", "pl-3"] as const

type TocEntry = HeadingOutlineEntry & { readonly depth: number }

/**
 * 実際に目次へ並ぶ項目。見出しレベルは埋め込み文脈で変わるため、絶対レベル
 * ではなく「最も浅い見出しからの相対の深さ」で数える。
 *
 * 呼び出し側もこれを使って器(右レールやdisclosure)を出すかどうかを決める。
 * `outline.length`で判断すると、見出しが1つだけの記事で空の「目次」と
 * 幅だけ取るレールが残ってしまう。
 */
export function tocEntries(
  outline: readonly HeadingOutlineEntry[]
): readonly TocEntry[] {
  if (outline.length === 0) return []

  const shallowest = Math.min(...outline.map((entry) => entry.level))
  const entries = outline
    .map((entry) => ({ ...entry, depth: entry.level - shallowest }))
    .filter((entry) => entry.depth < MAXIMUM_DEPTH)

  return entries.length < MINIMUM_ENTRIES ? [] : entries
}

/**
 * 本文の見出しから作る目次。並ぶ項目が無ければ何も描かない。
 */
export function MarkdownToc({
  outline,
  activeId,
  className,
  label = "目次",
}: MarkdownTocProps) {
  const entries = tocEntries(outline)
  if (entries.length === 0) return null

  return (
    <nav aria-label={label} className={cn("text-sm", className)}>
      <p className="mb-2 font-medium text-foreground">{label}</p>
      <ol className="space-y-1">
        {entries.map((entry) => (
          <li className={INDENT_CLASS[entry.depth]} key={entry.id}>
            <a
              aria-current={entry.id === activeId ? "location" : undefined}
              className={cn(
                "block rounded-sm py-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                entry.id === activeId && "font-medium text-foreground"
              )}
              href={`#${encodeURIComponent(entry.id)}`}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
