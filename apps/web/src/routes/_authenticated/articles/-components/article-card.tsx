import { Bookmark, BookmarkCheck, ExternalLink, FileText } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import {
  archiveLabel,
  isArchived,
  publishedAtLabel,
  type Article,
} from "../-model"

export type ArticleCardProps = {
  readonly article: Article
  readonly onToggleSaved: (article: Article) => void
  readonly onOpenArchive: (article: Article) => void
}

export function ArticleCard({
  article,
  onOpenArchive,
  onToggleSaved,
}: ArticleCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>{article.title}</h2>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>{article.sourceName}</span>
          {article.publishedAt ? (
            <time dateTime={article.publishedAt}>
              {publishedAtLabel(article.publishedAt)}
            </time>
          ) : null}
          <Badge
            variant={
              isArchived(article.archiveStatus) ? "secondary" : "outline"
            }
          >
            {archiveLabel(article.archiveStatus)}
          </Badge>
        </CardDescription>
        <CardAction className="flex gap-1">
          <Button
            aria-label={article.saved ? "保存を解除" : "記事を保存"}
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
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {article.summary ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {article.summary}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {article.archiveUrl ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={article.archiveUrl}
              onClick={() => onOpenArchive(article)}
              rel="noreferrer"
              target="_blank"
            >
              <FileText data-icon="inline-start" />
              アーカイブを読む
            </a>
          ) : null}
          <a
            className={buttonVariants({ variant: "ghost" })}
            href={article.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink data-icon="inline-start" />
            元の記事
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
