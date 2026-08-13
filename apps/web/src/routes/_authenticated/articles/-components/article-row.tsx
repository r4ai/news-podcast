import { Bookmark, BookmarkCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  archiveMetaLabel,
  articleSnippet,
  articleTimestamp,
  type Article,
} from "../-model"

export type ArticleRowProps = {
  readonly article: Article
  readonly isSelected: boolean
  readonly onToggleSaved: (article: Article) => void
  readonly onSelect: (article: Article) => void
}

/** 1件48〜72pxのコンパクト行。未読/既読を色と太さだけで表す (docs/design.md §7.1)。 */
export function ArticleRow({
  article,
  isSelected,
  onSelect,
  onToggleSaved,
}: ArticleRowProps) {
  const meta = archiveMetaLabel(article.archiveStatus)
  const snippet = articleSnippet(article)

  return (
    <div
      className={cn(
        "group/row flex min-h-12 items-start gap-2 border-b px-2.5 py-2 transition-colors last:border-b-0 hover:bg-muted/50 sm:min-h-14",
        isSelected &&
          "bg-accent shadow-[inset_3px_0_0_0_var(--primary)] hover:bg-accent"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-2.5 size-1.5 shrink-0 rounded-full",
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
            "line-clamp-2 text-sm leading-5",
            article.read
              ? "font-normal text-muted-foreground"
              : "font-medium text-foreground"
          )}
        >
          {article.title}
        </span>
        <span className="flex items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {article.sourceName}
          </span>
          <time dateTime={articleTimestamp(article)}>
            {compactArticleTimestamp(articleTimestamp(article))}
          </time>
          {meta ? <span>{meta}</span> : null}
        </span>
        {snippet ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {snippet}
          </span>
        ) : null}
      </button>
      <Button
        aria-label={article.saved ? "保存を解除" : "記事を保存"}
        className="mt-0.5 size-7 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100"
        onClick={() => onToggleSaved(article)}
        size="icon-sm"
        variant="ghost"
      >
        {article.saved ? (
          <BookmarkCheck aria-hidden="true" className="text-primary" />
        ) : (
          <Bookmark aria-hidden="true" className="text-muted-foreground/60" />
        )}
      </Button>
    </div>
  )
}

function compactArticleTimestamp(value: string): string {
  const date = new Date(value)
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return new Intl.DateTimeFormat(
    "ja-JP",
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" }
  ).format(date)
}
