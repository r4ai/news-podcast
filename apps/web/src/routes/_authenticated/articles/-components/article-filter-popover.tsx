import { SlidersHorizontal } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"

import {
  sortOptions,
  type ArticleFacets,
  type ArticlesSearch,
  type ArticleSort,
} from "../-model"

export type ArticleFilterPopoverProps = {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly onFeedIdsChange: (feedIds: readonly string[]) => void
  readonly onIncludeHiddenChange: (value: boolean) => void
  readonly onSortChange: (sort: ArticleSort) => void
}

/**
 * たまに触る軸 (並べ替え・媒体・非表示) をまとめるポップオーバー。
 * 主タブに出る状態(未読/あとで/保存/すべて)はここへ重複させない (docs要求)。
 *
 * 一覧パネルの幅は約380pxしかないので、常設するのは検索とタブだけにして、
 * ここへ寄せた分でタブが省略されずに収まるようにしている。
 */
export function ArticleFilterPopover({
  search,
  facets,
  onFeedIdsChange,
  onIncludeHiddenChange,
  onSortChange,
}: ArticleFilterPopoverProps) {
  const activeCount =
    search.feedIds.length +
    (search.includeHidden ? 1 : 0) +
    (search.sort === "newest" ? 0 : 1)

  function toggleFeed(feedId: string, checked: boolean) {
    onFeedIdsChange(
      checked
        ? [...search.feedIds, feedId]
        : search.feedIds.filter((id) => id !== feedId)
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              activeCount > 0
                ? `絞り込みと並べ替え (${activeCount}件適用中)`
                : "絞り込みと並べ替え"
            }
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <SlidersHorizontal aria-hidden="true" />
        {activeCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-4" side="bottom">
        <PopoverTitle>絞り込みと並べ替え</PopoverTitle>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="article-sort">並べ替え</Label>
          <Select
            items={sortOptions}
            onValueChange={(value) => onSortChange(value as ArticleSort)}
            value={search.sort}
          >
            <SelectTrigger id="article-sort" size="sm">
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
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            媒体
          </span>
          {facets && facets.feeds.length > 0 ? (
            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {facets.feeds.map((feed) => (
                <li className="flex items-center gap-2" key={feed.feedId}>
                  <Checkbox
                    checked={search.feedIds.includes(feed.feedId)}
                    id={`feed-${feed.feedId}`}
                    onCheckedChange={(checked) =>
                      toggleFeed(feed.feedId, checked === true)
                    }
                  />
                  <Label
                    className="flex-1 justify-between text-sm font-normal"
                    htmlFor={`feed-${feed.feedId}`}
                  >
                    <span className="truncate">{feed.name}</span>
                    <span className="text-muted-foreground">{feed.count}</span>
                  </Label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              購読中の媒体がありません
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="article-include-hidden">非表示を含める</Label>
          <Switch
            checked={search.includeHidden}
            id="article-include-hidden"
            onCheckedChange={onIncludeHiddenChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
