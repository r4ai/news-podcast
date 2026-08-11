import { cn } from "@workspace/ui/lib/utils"

import { archiveMetaLabel, articleTimestamp, publishedAtLabel } from "../-model"
import type { Article } from "../-model"

export type ArticleReaderHeaderProps = {
  readonly article: Article
}

export function ArticleReaderHeader({ article }: ArticleReaderHeaderProps) {
  const meta = archiveMetaLabel(article.archiveStatus)
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="text-lg font-semibold text-balance">{article.title}</h1>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            article.read ? "bg-transparent" : "bg-primary"
          )}
        />
        <span>{article.sourceName}</span>
        <time dateTime={articleTimestamp(article)}>
          {publishedAtLabel(articleTimestamp(article))}
        </time>
        {meta ? <span>{meta}</span> : null}
      </div>
    </header>
  )
}
