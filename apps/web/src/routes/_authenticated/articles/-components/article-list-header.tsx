import { useSetAtom } from "jotai"
import { CheckCheck, Loader2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { enrichQueueOpenAtom } from "../-atoms"
import { useArticleListHeaderState } from "../-hooks/use-article-list"
import {
  type ArticleFacets,
  type ArticlesSearch,
  type ArticleSort,
  type ArticleState,
} from "../-model"
import { ArticleFilterPopover } from "./article-filter-popover"
import { ArticleSearchField } from "./article-search-field"
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

export type ArticleListHeaderProps = {
  readonly search: ArticlesSearch
  readonly onSearchChange: (
    patch: Partial<ArticlesSearch>,
    options?: { readonly replace?: boolean }
  ) => void
}

/**
 * 一覧のスクロール中も常に触れる操作面。
 *
 * 件数(facets)を購読するのはここだけ。以前は一覧パネルが受け取って配って
 * いたので、件数が1つ動くたびに記事行まで描き直されていた。
 *
 * lgでは一覧自身がスクロール領域なので上端へ、lg未満はページがスクロールし
 * 上部app barが`top-0`を占めるので、その分だけ下げて吸着させる。検索はトグルで
 * 畳まず常設する。スクロール位置に関係なく、開く操作を挟まずに絞り込みへ
 * 入れるようにするため。
 */
export function ArticleListHeader({
  search,
  onSearchChange,
}: ArticleListHeaderProps) {
  const header = useArticleListHeaderState(search)
  // ダイアログの開閉はatomが持つ。routeまで持ち上げると、開くたびに
  // 一覧全体が描き直される。
  const openEnrichQueue = useSetAtom(enrichQueueOpenAtom)

  return (
    <ArticleListHeaderView
      aiPending={header.aiPending}
      facets={header.facets}
      isMarkingAllRead={header.isMarkingAllRead}
      onFeedIdsChange={(feedIds: readonly string[]) =>
        onSearchChange({ feedIds })
      }
      onIncludeHiddenChange={(includeHidden: boolean) =>
        onSearchChange({ includeHidden })
      }
      onMarkAllRead={header.markAllRead}
      onQCommit={(q: string) => onSearchChange({ q }, { replace: true })}
      onShowEnrichQueue={() => openEnrichQueue(true)}
      onSortChange={(sort: ArticleSort) => onSearchChange({ sort })}
      onStateChange={(state: ArticleState) => onSearchChange({ state })}
      search={search}
    />
  )
}

export type ArticleListHeaderViewProps = {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  /** 検索語がURLへ確定したときに呼ばれる。打鍵ごとではない。 */
  readonly onQCommit: (value: string) => void
  readonly onStateChange: (state: ArticleState) => void
  readonly onSortChange: (sort: ArticleSort) => void
  readonly onFeedIdsChange: (feedIds: readonly string[]) => void
  readonly onIncludeHiddenChange: (value: boolean) => void
  readonly onMarkAllRead: () => void
  readonly isMarkingAllRead: boolean
  readonly aiPending: number | undefined
  readonly onShowEnrichQueue: () => void
}

export function ArticleListHeaderView({
  search,
  facets,
  aiPending,
  onQCommit,
  onStateChange,
  onMarkAllRead,
  onShowEnrichQueue,
  isMarkingAllRead,
  ...filterProps
}: ArticleListHeaderViewProps) {
  return (
    <div className="sticky top-[var(--app-bar-h)] z-20 flex h-[var(--article-header-h)] shrink-0 flex-col justify-center gap-2 border-b bg-background/70 px-3 backdrop-blur-xl md:top-0">
      {/* 1段目: 探す操作。パネル幅が狭いので、常設するのは検索だけにする。 */}
      <div className="flex items-center gap-1">
        <ArticleSearchField onCommit={onQCommit} q={search.q} />

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
