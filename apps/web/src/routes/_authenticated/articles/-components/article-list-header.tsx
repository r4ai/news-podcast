import { CheckCheck, Loader2, Search, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { ARTICLE_SEARCH_INPUT_ID } from "../-hooks/use-article-keyboard-shortcuts"
import {
  type ArticleFacets,
  type ArticlesSearch,
  type ArticleState,
} from "../-model"
import {
  ArticleFilterPopover,
  type ArticleFilterPopoverProps,
} from "./article-filter-popover"
import { ArticleStateTabs } from "./article-state-tabs"

/**
 * ヘッダーの実高。日付見出しはこの直下へ吸着する。
 * 段数や行の高さを変えたら、この値も必ず合わせる。
 */
export const ARTICLE_HEADER_HEIGHT = "[--article-header-h:5.5rem]"

/**
 * 日付見出しの吸着位置。lg未満はページがスクロールするのでapp barの分だけ
 * 押し下げ、md以上はapp barが無いのでヘッダーの高さだけで足りる。
 */
export const ARTICLE_GROUP_STICKY_TOP =
  "top-[calc(var(--app-bar-h)+var(--article-header-h))] md:top-[var(--article-header-h)]"

/**
 * 一覧のスクロール中も常に触れる操作面。
 *
 * lgでは一覧自身がスクロール領域なので上端へ、lg未満はページがスクロールし
 * 上部app barが`top-0`を占めるので、その分だけ下げて吸着させる。
 * 検索はトグルで畳まず常設する。スクロール位置に関係なく、開く操作を挟まずに
 * 絞り込みへ入れるようにするため。
 */
export type ArticleListHeaderProps = Omit<
  ArticleFilterPopoverProps,
  "facets" | "search"
> & {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly q: string
  readonly onQChange: (value: string) => void
  readonly onStateChange: (state: ArticleState) => void
  readonly onMarkAllRead: () => void
  readonly isMarkingAllRead: boolean
  readonly aiPending: number | undefined
  readonly onShowEnrichQueue: () => void
}

export function ArticleListHeader({
  search,
  facets,
  q,
  aiPending,
  onQChange,
  onStateChange,
  onMarkAllRead,
  onShowEnrichQueue,
  isMarkingAllRead,
  ...filterProps
}: ArticleListHeaderProps) {
  return (
    <div className="sticky top-[var(--app-bar-h)] z-20 flex h-[var(--article-header-h)] shrink-0 flex-col justify-center gap-2 rounded-t-xl border-b bg-background/70 px-3 backdrop-blur-xl md:top-0">
      {/* 1段目: 探す操作。パネル幅が狭いので、常設するのは検索だけにする。 */}
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="記事を検索"
            className="h-8 bg-background/60 pr-8 pl-8"
            id={ARTICLE_SEARCH_INPUT_ID}
            onChange={(event) => onQChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onQChange("")
            }}
            placeholder="タイトルや本文で検索"
            value={q}
          />
          {q ? (
            <Button
              aria-label="検索条件を消す"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => onQChange("")}
              size="icon-xs"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <ArticleFilterPopover
          facets={facets}
          search={search}
          {...filterProps}
        />

        {aiPending ? (
          <Button
            aria-label={`AI処理待ち ${aiPending}件。キューの状態を開く`}
            onClick={onShowEnrichQueue}
            size="icon-sm"
            variant="ghost"
          >
            <Loader2 aria-hidden="true" className="animate-spin" />
          </Button>
        ) : null}
      </div>

      {/* 2段目: 状態の切り替えと一括既読。 */}
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ArticleStateTabs
            facets={facets}
            onChange={onStateChange}
            value={search.state}
          />
        </div>
        {/* 一括操作なので、アイコンだけにせず何が起きるかを字で残す。 */}
        <Button
          className="shrink-0"
          disabled={isMarkingAllRead}
          onClick={onMarkAllRead}
          size="sm"
          variant="ghost"
        >
          <CheckCheck aria-hidden="true" data-icon="inline-start" />
          すべて既読
        </Button>
      </div>
    </div>
  )
}
