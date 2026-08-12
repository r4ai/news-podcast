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
  periodOptions,
  type ArticleFacets,
  type ArticlePeriod,
  type ArticlesSearch,
  type ArticleStatusFilter,
  type Tag,
} from "../-model"

const archiveStatusOptions: readonly {
  value: ArticleStatusFilter
  label: string
}[] = [
  { value: "all", label: "すべて" },
  { value: "pending", label: "保存待ち" },
  { value: "archiving", label: "保存中" },
  { value: "succeeded", label: "保存済み" },
  { value: "failed", label: "保存失敗" },
]

export type ArticleFilterPopoverProps = {
  readonly search: ArticlesSearch
  readonly facets: ArticleFacets | undefined
  readonly tags: readonly Tag[]
  readonly onFeedIdsChange: (feedIds: readonly string[]) => void
  readonly onPeriodChange: (period: ArticlePeriod) => void
  readonly onArchiveStatusFilterChange: (value: ArticleStatusFilter) => void
  readonly onIncludeHiddenChange: (value: boolean) => void
  readonly onUsedInEpisodeChange: (value: boolean) => void
  readonly onTagIdsChange: (tagIds: readonly string[]) => void
}

/**
 * たまに触る絞り込み軸をまとめるポップオーバー。主タブに出る状態(未読/あとで/保存/すべて)は
 * ここへ重複させない (docs要求)。
 */
export function ArticleFilterPopover({
  search,
  facets,
  tags,
  onArchiveStatusFilterChange,
  onFeedIdsChange,
  onIncludeHiddenChange,
  onPeriodChange,
  onTagIdsChange,
  onUsedInEpisodeChange,
}: ArticleFilterPopoverProps) {
  const activeCount =
    search.feedIds.length +
    (search.period !== "all" ? 1 : 0) +
    (search.archiveStatusFilter !== "all" ? 1 : 0) +
    (search.includeHidden ? 1 : 0) +
    (search.usedInEpisode ? 1 : 0) +
    search.tagIds.length

  function toggleFeed(feedId: string, checked: boolean) {
    onFeedIdsChange(
      checked
        ? [...search.feedIds, feedId]
        : search.feedIds.filter((id) => id !== feedId)
    )
  }

  function toggleTag(tagId: string, checked: boolean) {
    onTagIdsChange(
      checked
        ? [...search.tagIds, tagId]
        : search.tagIds.filter((id) => id !== tagId)
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

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            タグ
          </span>
          {tags.length > 0 ? (
            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {tags.map((tag) => (
                <li className="flex items-center gap-2" key={tag.id}>
                  <Checkbox
                    checked={search.tagIds.includes(tag.id)}
                    id={`tag-${tag.id}`}
                    onCheckedChange={(checked) =>
                      toggleTag(tag.id, checked === true)
                    }
                  />
                  <Label
                    className="flex-1 text-sm font-normal"
                    htmlFor={`tag-${tag.id}`}
                  >
                    {tag.name}
                  </Label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              タグがまだありません
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="article-period">期間</Label>
            <Select
              items={periodOptions}
              onValueChange={(value) => onPeriodChange(value as ArticlePeriod)}
              value={search.period}
            >
              <SelectTrigger id="article-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="article-archive-status">アーカイブ状態</Label>
            <Select
              items={archiveStatusOptions}
              onValueChange={(value) =>
                onArchiveStatusFilterChange(value as ArticleStatusFilter)
              }
              value={search.archiveStatusFilter}
            >
              <SelectTrigger id="article-archive-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {archiveStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="article-include-hidden">非表示を含める</Label>
          <Switch
            checked={search.includeHidden}
            id="article-include-hidden"
            onCheckedChange={onIncludeHiddenChange}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="article-used-in-episode">番組採用のみ</Label>
          <Switch
            checked={search.usedInEpisode}
            id="article-used-in-episode"
            onCheckedChange={onUsedInEpisodeChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
