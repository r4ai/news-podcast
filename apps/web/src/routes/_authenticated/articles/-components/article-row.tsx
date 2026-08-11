import { Bookmark, BookmarkCheck, Mic } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  archiveMetaLabel,
  articleSnippet,
  articleTimestamp,
  publishedAtLabel,
  type Article,
} from "../-model"

export type ArticleRowProps = {
  readonly article: Article
  readonly isSelected: boolean
  /** おすすめ順のときだけtrue。この時だけスコアを数値表示する。 */
  readonly showRelevanceScore: boolean
  readonly onToggleSaved: (article: Article) => void
  readonly onSelect: (article: Article) => void
}

/** 1件48〜72pxのコンパクト行。未読/既読を色と太さだけで表す (docs/design.md §7.1)。 */
export function ArticleRow({
  article,
  isSelected,
  showRelevanceScore,
  onSelect,
  onToggleSaved,
}: ArticleRowProps) {
  const meta = archiveMetaLabel(article.archiveStatus)
  const snippet = articleSnippet(article)

  return (
    <div
      className={cn(
        "flex min-h-12 items-start gap-3 border-b px-3 py-2.5 last:border-b-0 sm:min-h-14",
        isSelected && "bg-accent"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 size-1.5 shrink-0 rounded-full",
          article.read ? "bg-transparent" : "bg-primary"
        )}
      />
      <button
        aria-current={isSelected ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onSelect(article)}
        type="button"
      >
        <span
          className={cn(
            "truncate text-sm",
            article.read
              ? "font-normal text-muted-foreground"
              : "font-medium text-foreground"
          )}
        >
          {article.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{article.sourceName}</span>
          <time dateTime={articleTimestamp(article)}>
            {publishedAtLabel(articleTimestamp(article))}
          </time>
          {meta ? <span>{meta}</span> : null}
          {article.usedInEpisode ? (
            <Mic aria-label="番組で採用済み" className="size-3" role="img" />
          ) : null}
          {showRelevanceScore && typeof article.relevanceScore === "number" ? (
            <span
              aria-label={`適合度スコア ${article.relevanceScore}`}
              className="font-medium text-foreground"
            >
              {article.relevanceScore}
            </span>
          ) : null}
        </span>
        {snippet ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {snippet}
          </span>
        ) : null}
        {article.tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {article.tags.map((tag) => (
              <Badge className="text-[0.625rem]" key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </span>
        ) : null}
      </button>
      <Button
        aria-label={article.saved ? "保存を解除" : "記事を保存"}
        className="mt-0.5 size-11 shrink-0 sm:size-7"
        onClick={() => onToggleSaved(article)}
        size="icon-sm"
        variant="ghost"
      >
        {article.saved ? (
          <BookmarkCheck aria-hidden="true" />
        ) : (
          <Bookmark aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
