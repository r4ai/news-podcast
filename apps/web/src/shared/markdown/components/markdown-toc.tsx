import { ChevronDown, List } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

export type MarkdownTocProps = {
  readonly outline: readonly HeadingOutlineEntry[]
  /** 現在読んでいる見出しのid。`useActiveHeading`が求める。 */
  readonly activeId?: string
  readonly className?: string
  readonly label?: string
  /**
   * 開いた状態で描き始めるか。右レールは開いたまま(本文と並ぶので邪魔にならない)、
   * 本文の前に置く器は畳んだまま(開くと本文が毎回その分だけ下へ押される)。
   */
  readonly defaultOpen?: boolean
}

/** 深い見出しまで並べると目次が本文より長くなるので、2階層までにする。 */
const MAXIMUM_DEPTH = 2

/** 1件だけの目次は行き先が1つしかなく、案内にならない。 */
const MINIMUM_ENTRIES = 2

const INDENT_CLASS = ["pl-3", "pl-6"] as const

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
 * 高さのtransitionはBase UIが実測して配る`--collapsible-panel-height`へ掛ける。
 * `auto`は補間できないので、開閉のたびにJSで高さを測る実装が要らなくなる。
 * 閉じた側の高さ0は`data-starting-style` / `data-ending-style`が受け持つ。
 *
 * `hidden`の除外は`hidden="until-found"`のためにある。畳んだ中身もブラウザの
 * ページ内検索から見つけられるよう、DOMには残したまま隠す(`<details>`が
 * 持っていた性質をここで引き継ぐ)。
 */
const PANEL_ANIMATION =
  "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none [&[hidden]:not([hidden='until-found'])]:hidden data-starting-style:h-0 data-ending-style:h-0"

/**
 * 本文の見出しから作る目次。並ぶ項目が無ければ何も描かない。
 *
 * 項目は左の罫を軸に並べ、読んでいる節だけが軸の色を持つ。行そのものを塗ると
 * 面が増えて本文と競うので、位置は罫、状態は文字の濃さで表す。
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
        <List
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="flex-1 text-xs font-semibold tracking-wide text-foreground/80 uppercase">
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {entries.length}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className={PANEL_ANIMATION} hiddenUntilFound>
        <ol className="mr-2 mb-2.5 ml-3.5 flex flex-col border-l border-border/70">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                aria-current={entry.id === activeId ? "location" : undefined}
                className={cn(
                  // 軸の罫と重ねる。項目ごとの罫が軸を上書きするので、
                  // 現在地の1本だけが濃く見える。
                  "-ml-px block border-l-2 border-transparent py-1 text-[0.8125rem] leading-5 text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  INDENT_CLASS[entry.depth],
                  entry.id === activeId &&
                    "border-primary font-medium text-foreground"
                )}
                href={`#${encodeURIComponent(entry.id)}`}
              >
                <span className="line-clamp-2">{entry.text}</span>
              </a>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
