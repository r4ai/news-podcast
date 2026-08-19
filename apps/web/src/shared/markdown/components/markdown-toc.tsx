import { ChevronDown, List } from "lucide-react"
import type { ReactNode } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"

import { COLLAPSIBLE_PANEL_ANIMATION } from "@/shared/lib/collapsible"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

export type MarkdownTocProps = {
  readonly outline: readonly HeadingOutlineEntry[]
  /** 現在読んでいる見出しのid。`useActiveHeading`が求める。 */
  readonly activeId?: string
  readonly className?: string
  readonly label?: string
  /**
   * 開いた状態で描き始めるか。本文の前に置く器は畳んだまま(開くと本文が
   * 毎回その分だけ下へ押される)。
   */
  readonly defaultOpen?: boolean
}

/** 深い見出しまで並べると目次が本文より長くなるので、2階層までにする。 */
const MAXIMUM_DEPTH = 2

/** 1件だけの目次は行き先が1つしかなく、案内にならない。 */
const MINIMUM_ENTRIES = 2

export type TocEntry = HeadingOutlineEntry & { readonly depth: number }

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
 * 見出しの深さを示す目印。通しの罫を1本引くと、どの項目がどの節に属するかが
 * 罫では分からないまま、目次の丈だけが伸びる。深さごとに形の違う小さな目印を
 * 置き、現在地はその目印の色で示す。面(行の背景)は塗らない。本文と競う。
 */
function DepthMarker({
  depth,
  active,
}: {
  readonly depth: number
  readonly active: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[0.5rem] shrink-0 rounded-full transition-colors",
        depth === 0
          ? "h-1.5 w-1.5"
          : // 下位はそれ自体では立たない印にする。点を並べると同じ重みに見える。
            "ml-1 h-px w-2",
        active
          ? "bg-primary"
          : depth === 0
            ? "bg-muted-foreground/45"
            : "bg-muted-foreground/35"
      )}
    />
  )
}

export type MarkdownTocListProps = {
  readonly entries: readonly TocEntry[]
  readonly activeId?: string
  readonly className?: string
}

/**
 * 目次の項目そのもの。器 (畳める本文前の器・右のレール) から独立させて、
 * 見え方をひとつに揃える。
 */
export function MarkdownTocList({
  entries,
  activeId,
  className,
}: MarkdownTocListProps) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry) => {
        const active = entry.id === activeId
        return (
          <li key={entry.id}>
            <a
              aria-current={active ? "location" : undefined}
              className={cn(
                "flex items-start gap-2 rounded-md py-1 pr-1.5 transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                entry.depth === 0
                  ? "pl-1.5 text-[0.8125rem] leading-5"
                  : "pl-3 text-xs leading-5",
                active ? "font-medium text-foreground" : "text-muted-foreground"
              )}
              href={`#${encodeURIComponent(entry.id)}`}
            >
              <DepthMarker active={active} depth={entry.depth} />
              <span className="line-clamp-2">{entry.text}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

export type MarkdownTocHeaderProps = {
  readonly label: string
  readonly count: number
  readonly children?: ReactNode
}

/** 器の見出し。畳める器と固定できるレールで同じ並びにする。 */
export function MarkdownTocHeader({
  label,
  count,
  children,
}: MarkdownTocHeaderProps) {
  return (
    <>
      <List
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="flex-1 text-xs font-semibold tracking-wide text-foreground/80 uppercase">
        {label}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
      {children}
    </>
  )
}

/**
 * 本文の見出しから作る、畳める目次。並ぶ項目が無ければ何も描かない。
 * 幅に余裕がある画面の目次は`ArticleTocRail`が別に持つ。
 */
export function MarkdownToc({
  outline,
  activeId,
  className,
  label = "目次",
  defaultOpen = true,
}: MarkdownTocProps) {
  const entries = tocEntries(outline)
  if (entries.length === 0) return null

  return (
    <Collapsible
      className={cn(
        "rounded-xl border border-border/70 bg-card/40 text-sm",
        className
      )}
      defaultOpen={defaultOpen}
      // ランドマークとして名前を持つのはこの器。`<aside>`にはしない
      // (AppShellのサイドバーが既にcomplementaryを持つため)。
      render={<nav aria-label={label} />}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <MarkdownTocHeader count={entries.length} label={label}>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180 motion-reduce:transition-none"
          />
        </MarkdownTocHeader>
      </CollapsibleTrigger>

      <CollapsibleContent
        className={COLLAPSIBLE_PANEL_ANIMATION}
        hiddenUntilFound
      >
        <MarkdownTocList
          activeId={activeId}
          className="mr-2 mb-2.5 ml-2.5"
          entries={entries}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
