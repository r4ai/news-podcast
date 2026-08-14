import { cn } from "@workspace/ui/lib/utils"

import { archiveMetaLabel, articleTimestamp, publishedAtLabel } from "../-model"
import type { Article } from "../-model"

export type ArticleReaderHeaderProps = {
  readonly article: Article
}

export function ArticleReaderHeader({ article }: ArticleReaderHeaderProps) {
  const meta = archiveMetaLabel(article.archiveStatus)
  return (
    <header className="flex flex-col gap-2">
      {/* ページのlevel-1見出しはroute側が持つので、本文の題名はlevel-2にする。 */}
      <h2 className="flex items-start gap-2 text-xl leading-snug font-semibold text-balance">
        <span
          aria-hidden="true"
          className={cn(
            "mt-2.5 size-1.5 shrink-0 rounded-full",
            article.read ? "bg-transparent" : "bg-primary"
          )}
        />
        {article.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {article.sourceName}
        </span>
        <span aria-hidden="true">·</span>
        <time dateTime={articleTimestamp(article)}>
          {publishedAtLabel(articleTimestamp(article))}
        </time>
        {meta ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{meta}</span>
          </>
        ) : null}
      </div>
    </header>
  )
}
