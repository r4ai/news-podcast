import { CheckCheck, Loader2, Search, X } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
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

export type ArticleToolbarProps = Omit<
  ArticleFilterPopoverProps,
  "facets" | "search"
> & {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly q: string
  readonly onQChange: (value: string) => void
  readonly onStateChange: (state: ArticleState) => void
  readonly onSortChange: (sort: ArticleSort) => void
  readonly onMarkAllRead: () => void
  readonly isMarkingAllRead: boolean
  /** 絞り込み条件に依存しない、購読全体のAI補助バッチ未処理件数。0または未取得なら出さない。 */
  readonly aiPending: number | undefined
}

function tabCount(facets: ArticleFacets | undefined, state: ArticleState) {
  return facets?.states[state === "all" ? "all" : state]
}

/** 毎回触る軸(状態タブ・並べ替え・検索)をまとめたツールバー。 */
export function ArticleToolbar({
  search,
  facets,
  q,
  aiPending,
  tags,
  onQChange,
  onStateChange,
  onSortChange,
  onMarkAllRead,
  onTagIdsChange,
  isMarkingAllRead,
  ...filterProps
}: ArticleToolbarProps) {
  const selectedTags = tags.filter((tag) => search.tagIds.includes(tag.id))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          aria-label="記事の状態"
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

        <div className="flex items-center gap-2">
          {aiPending ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              AI処理待ち {aiPending}件
            </span>
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="記事を検索"
            className="pl-8"
            id={ARTICLE_SEARCH_INPUT_ID}
            onChange={(event) => onQChange(event.target.value)}
            placeholder="タイトルや本文で検索"
            value={q}
          />
        </div>

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
          onTagIdsChange={onTagIdsChange}
          search={search}
          tags={tags}
          {...filterProps}
        />
      </div>

      {selectedTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((tag) => (
            <Badge
              key={tag.id}
              render={
                <button
                  aria-label={`「${tag.name}」の絞り込みを外す`}
                  onClick={() =>
                    onTagIdsChange(search.tagIds.filter((id) => id !== tag.id))
                  }
                  type="button"
                />
              }
              variant="secondary"
            >
              {tag.name}
              <X aria-hidden="true" data-icon="inline-end" />
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
