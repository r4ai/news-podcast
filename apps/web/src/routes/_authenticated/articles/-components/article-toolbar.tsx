import { CheckCheck, Loader2, Search } from "lucide-react"
import { useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { ARTICLE_SEARCH_INPUT_ID } from "../-hooks/use-article-keyboard-shortcuts"
import {
  sortOptions,
  stateTabs,
  type ArticleFacets,
  type ArticlesSearch,
  type ArticleSort,
  type ArticleState,
} from "../-model"
import {
  ArticleFilterPopover,
  type ArticleFilterPopoverProps,
} from "./article-filter-popover"

export type ArticleToolbarStickyProps = {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly onStateChange: (state: ArticleState) => void
  readonly searchExpanded: boolean
  readonly onToggleSearch: () => void
}

function tabCount(facets: ArticleFacets | undefined, state: ArticleState) {
  return facets?.states[state === "all" ? "all" : state]
}

export function ArticleToolbarSticky({
  search,
  facets,
  onStateChange,
  searchExpanded,
  onToggleSearch,
}: ArticleToolbarStickyProps) {
  return (
    <div className="sticky top-0 z-20 -mx-3 flex h-10 items-center justify-between gap-2 border-b px-3 py-1 backdrop-blur-md">
      <ToggleGroup
        aria-label="記事の状態"
        className="gap-0.5 overflow-hidden"
        onValueChange={(value) => {
          const [next] = value
          if (next) onStateChange(next as ArticleState)
        }}
        value={[search.state]}
      >
        {stateTabs.map((tab) => (
          <ToggleGroupItem key={tab.value} value={tab.value}>
            {tab.label}
            {tabCount(facets, tab.value) !== undefined
              ? ` (${tabCount(facets, tab.value)})`
              : ""}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Button
        aria-expanded={searchExpanded}
        aria-label="検索を開く"
        onClick={onToggleSearch}
        size="icon-sm"
        variant="ghost"
      >
        <Search className="size-4" />
      </Button>
    </div>
  )
}

export type ArticleToolbarProps = Omit<
  ArticleFilterPopoverProps,
  "facets" | "search"
> & {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly q: string
  readonly onQChange: (value: string) => void
  readonly onSortChange: (sort: ArticleSort) => void
  readonly onMarkAllRead: () => void
  readonly isMarkingAllRead: boolean
  readonly aiPending: number | undefined
  readonly onShowEnrichQueue: () => void
  readonly searchExpanded: boolean
  readonly onToggleSearch: () => void
}

export function ArticleToolbar({
  search,
  facets,
  q,
  aiPending,
  onQChange,
  onSortChange,
  onMarkAllRead,
  onShowEnrichQueue,
  isMarkingAllRead,
  searchExpanded,
  onToggleSearch,
  ...filterProps
}: ArticleToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  function handleSearchBlur() {
    if (!q.trim()) {
      onToggleSearch()
    }
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        {searchExpanded ? (
          <div className="relative min-w-48 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="記事を検索"
              className="pl-8"
              id={ARTICLE_SEARCH_INPUT_ID}
              onBlur={handleSearchBlur}
              onChange={(event) => onQChange(event.target.value)}
              placeholder="タイトルや本文で検索"
              ref={searchInputRef}
              value={q}
            />
          </div>
        ) : null}

        <Select
          items={sortOptions}
          onValueChange={(value) => onSortChange(value as ArticleSort)}
          value={search.sort}
        >
          <SelectTrigger aria-label="並べ替え">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ArticleFilterPopover
          facets={facets}
          search={search}
          {...filterProps}
        />

        <div className="flex items-center gap-1">
          {aiPending ? (
            <button
              aria-label="AI処理のキュー状態を開く"
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={onShowEnrichQueue}
              type="button"
            >
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              AI処理待ち {aiPending}件
            </button>
          ) : null}
          <Button
            disabled={isMarkingAllRead}
            onClick={onMarkAllRead}
            size="sm"
            variant="ghost"
          >
            <CheckCheck data-icon="inline-start" />
            すべて既読
          </Button>
        </div>
      </div>
    </div>
  )
}
