import { List, Pin, PinOff } from "lucide-react"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  MarkdownTocHeader,
  MarkdownTocList,
  type TocEntry,
} from "@/shared/markdown"

export type ArticleTocRailProps = {
  readonly entries: readonly TocEntry[]
  readonly activeId: string | undefined
}

const LABEL = "目次"

/**
 * 目次の中身と、固定/格納を切り替える見出し。
 *
 * 見出しの行そのものが切り替えになる。畳める器 (狭い幅) で開閉に使う場所と
 * 同じ位置に同じ操作を置くことで、幅が変わっても押す場所が動かない。
 */
function TocPanel({
  entries,
  activeId,
  pinned,
  onTogglePinned,
}: ArticleTocRailProps & {
  readonly pinned: boolean
  readonly onTogglePinned: () => void
}) {
  return (
    <nav
      // ランドマークの名前はこの器が持つ。`<aside>`にはしない
      // (AppShellのサイドバーが既にcomplementaryを持つため)。
      aria-label={LABEL}
      className={cn(
        "flex max-h-full flex-col overflow-hidden rounded-xl text-sm",
        // 浮いている間だけ枠と影を持つ。固定した後は本文と並ぶ柱なので、
        // 面を足さず余白だけで分ける。
        pinned
          ? "border border-transparent"
          : "border border-border/70 bg-popover shadow-lg"
      )}
    >
      <button
        aria-label={
          pinned ? "目次を画面外へ格納する" : "目次を固定して常に表示する"
        }
        aria-pressed={pinned}
        className="group flex w-full shrink-0 items-center gap-2 rounded-t-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onTogglePinned}
        type="button"
      >
        <MarkdownTocHeader count={entries.length} label={LABEL}>
          {pinned ? (
            <PinOff
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : (
            <Pin
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
        </MarkdownTocHeader>
      </button>
      <MarkdownTocList
        activeId={activeId}
        className="min-h-0 overflow-y-auto overscroll-contain px-2.5 pb-2.5"
        entries={entries}
      />
    </nav>
  )
}

/**
 * 幅に余裕がある画面 (`xl`) の目次。
 *
 * 目次を縦に畳んでも、空いた1列は空いたままで本文は広がらない。畳む方向を
 * 横にして、格納したときは画面の外へ送る。格納中は右端の掴み代へ触れると
 * 覆いとして滑り出し、見出しの行を押すと列として固定される
 * (docs/design.md §7.1)。
 *
 * 狭い幅では何も描かない。そちらは本文の前に置く`MarkdownToc`が受け持つ。
 */
export function ArticleTocRail({ entries, activeId }: ArticleTocRailProps) {
  const [pinned, setPinned] = useState(false)
  const [peeking, setPeeking] = useState(false)

  if (entries.length === 0) return null

  if (pinned) {
    return (
      // stickyは器のこの`div`が持つ。中身側をstickyにすると、追従できる範囲が
      // 器の高さで尽きる。`self-start`で高さを中身へ戻し、動ける余地を本文の
      // 長さぶん残す。
      <div className="sticky top-4 hidden max-h-[calc(100dvh-var(--player-h)-6rem)] w-60 shrink-0 self-start xl:block">
        <TocPanel
          activeId={activeId}
          entries={entries}
          onTogglePinned={() => {
            setPinned(false)
            setPeeking(false)
          }}
          pinned
        />
      </div>
    )
  }

  return (
    // 格納中は本文の並びから外れる。列が空かないので、本文はその分だけ広がる。
    <div
      className="hidden xl:block"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPeeking(false)
      }}
      onFocus={() => setPeeking(true)}
      onPointerEnter={() => setPeeking(true)}
      onPointerLeave={() => setPeeking(false)}
    >
      {/*
        右端の掴み代。ホバーの当たり判定であると同時に、キーボードから目次へ
        入る唯一の入口でもある。ホバーだけに頼ると到達できない。
      */}
      <button
        aria-label="目次を開いて固定する"
        className={cn(
          "fixed top-1/2 right-0 z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 border-border/70 bg-background/95 py-3.5 pr-1.5 pl-2 text-muted-foreground shadow-sm outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          // 覆いが出ている間は掴み代を隠す。覆いの下から縁だけがはみ出す。
          peeking && "opacity-0"
        )}
        onClick={() => setPinned(true)}
        type="button"
      >
        <List aria-hidden="true" className="size-3.5" />
        <span className="text-[0.625rem] font-semibold tracking-wide uppercase [writing-mode:vertical-rl]">
          {LABEL}
        </span>
      </button>

      {/*
        覆い。閉じている間は画面の外へ送るだけでDOMには残す。付け外しにすると
        滑り込みが描けず、ページ内検索からも消える。
      */}
      <div
        className={cn(
          "fixed top-20 right-3 z-30 flex max-h-[calc(100dvh-var(--player-h)-8rem)] w-64 transition-transform duration-200 ease-out motion-reduce:transition-none",
          peeking ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"
        )}
        // 画面外にある間は掴めないようにする。透明な板が右端に居座ると、
        // その下の本文を選べなくなる。
        inert={!peeking}
      >
        <TocPanel
          activeId={activeId}
          entries={entries}
          onTogglePinned={() => {
            setPinned(true)
            setPeeking(false)
          }}
          pinned={false}
        />
      </div>
    </div>
  )
}
