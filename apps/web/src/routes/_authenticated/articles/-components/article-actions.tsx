import {
  Bookmark,
  BookmarkCheck,
  Clock,
  ClockAlert,
  ExternalLink,
  EyeOff,
  Mail,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { Article } from "../-model"

export type ArticleActionsProps = {
  readonly article: Article
  readonly onToggleSaved: () => void
  readonly onToggleReadLater: () => void
  readonly onToggleHidden: () => void
  readonly onMarkUnread: () => void
  readonly className?: string
}

/** 記事状態と元記事への操作列。トグルはaria-pressedで状態を示す (docs要求)。 */
export function ArticleActions({
  article,
  onToggleSaved,
  onToggleReadLater,
  onToggleHidden,
  onMarkUnread,
  className,
}: ArticleActionsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {article.read ? (
        <Button onClick={onMarkUnread} size="sm" variant="outline">
          <Mail data-icon="inline-start" />
          未読に戻す
        </Button>
      ) : null}
      <Button
        aria-pressed={article.saved}
        onClick={onToggleSaved}
        size="sm"
        variant={article.saved ? "secondary" : "outline"}
      >
        {article.saved ? (
          <BookmarkCheck data-icon="inline-start" />
        ) : (
          <Bookmark data-icon="inline-start" />
        )}
        保存
      </Button>
      <Button
        aria-pressed={article.readLater}
        onClick={onToggleReadLater}
        size="sm"
        variant={article.readLater ? "secondary" : "outline"}
      >
        {article.readLater ? (
          <ClockAlert data-icon="inline-start" />
        ) : (
          <Clock data-icon="inline-start" />
        )}
        あとで
      </Button>
      <Button
        aria-pressed={article.hidden}
        onClick={onToggleHidden}
        size="sm"
        variant={article.hidden ? "secondary" : "outline"}
      >
        <EyeOff data-icon="inline-start" />
        非表示
      </Button>
      <Button
        nativeButton={false}
        render={<a href={article.url} rel="noreferrer" target="_blank" />}
        size="sm"
        variant="ghost"
      >
        <ExternalLink data-icon="inline-start" />
        元記事
      </Button>
    </div>
  )
}
