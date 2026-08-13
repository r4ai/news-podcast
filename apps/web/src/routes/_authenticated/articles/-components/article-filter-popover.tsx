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
import { Switch } from "@workspace/ui/components/switch"

import { type ArticleFacets, type ArticlesSearch } from "../-model"

export type ArticleFilterPopoverProps = {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly onFeedIdsChange: (feedIds: readonly string[]) => void
  readonly onIncludeHiddenChange: (value: boolean) => void
}

/**
 * たまに触る絞り込み軸をまとめるポップオーバー。主タブに出る状態(未読/あとで/保存/すべて)は
 * ここへ重複させない (docs要求)。
 */
export function ArticleFilterPopover({
  search,
  facets,
  onFeedIdsChange,
  onIncludeHiddenChange,
}: ArticleFilterPopoverProps) {
  const activeCount = search.feedIds.length + (search.includeHidden ? 1 : 0)

  function toggleFeed(feedId: string, checked: boolean) {
    onFeedIdsChange(
      checked
        ? [...search.feedIds, feedId]
        : search.feedIds.filter((id) => id !== feedId)
    )
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <SlidersHorizontal data-icon="inline-start" />
        絞り込み
        {activeCount > 0 ? `(${activeCount})` : null}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-4" side="bottom">
        <PopoverTitle>絞り込み</PopoverTitle>

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
