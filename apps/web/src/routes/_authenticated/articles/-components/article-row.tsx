import { Bookmark, BookmarkCheck } from "lucide-react"
import { memo, useEffect, useRef } from "react"

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

/**
 * 1件48〜72pxのコンパクト行。未読/既読を色と太さだけで表す (docs/design.md §7.1)。
 *
 * 行は保存ボタンを内包するので`listbox/option`にはできない (optionは操作可能な
 * 子孫を持てない)。素の`ul/li`で組み、選択は本文ボタンの`aria-current`で表す。
 * j/kで選択が動いた行は自分でスクロール位置へ入る。
 */
export const ArticleRow = memo(function ArticleRow({
  article,
  isSelected,
  onSelect,
  onToggleSaved,
}: ArticleRowProps) {
  const meta = archiveMetaLabel(article.archiveStatus)
  const snippet = articleSnippet(article)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [isSelected])

  return (
    <li
      className={cn(
        "group/row relative flex items-start gap-2 border-b border-border/60 pr-1.5 pl-2.5 transition-colors last:border-b-0 hover:bg-muted/50 has-focus-visible:bg-muted/50",
        isSelected && "bg-accent hover:bg-accent"
      )}
      ref={ref}
    >
      {/* 選択中の左罫。行の背景色だけに頼らず、位置も一目で分かるようにする。 */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          isSelected ? "bg-primary" : "bg-transparent"
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-3.5 size-1.5 shrink-0 rounded-full",
          article.read ? "bg-transparent" : "bg-primary"
        )}
      />
      <button
        aria-current={isSelected ? "true" : undefined}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
        {/*
          選択行の背景(accent)の上では muted-foreground が4.5:1を割るので、
          選択時だけ前景寄りの色へ上げる。
        */}
        <span
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 text-xs",
            isSelected ? "text-foreground/70" : "text-muted-foreground"
          )}
        >
          <span className="truncate font-medium text-foreground/80">
            {article.sourceName}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={articleTimestamp(article)}>
            {compactArticleTimestamp(articleTimestamp(article))}
          </time>
          {meta ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{meta}</span>
            </>
          ) : null}
        </span>
        {snippet ? (
          // muted-foregroundを更に薄めると4.5:1を割るので、透過は掛けない。
          <span
            className={cn(
              "line-clamp-1 text-xs",
              isSelected ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            {snippet}
          </span>
        ) : null}
      </button>
      <Button
        aria-label={
          article.saved
            ? `「${article.title}」の保存を解除`
            : `「${article.title}」を保存`
        }
        aria-pressed={article.saved}
        // hoverでしか出さないと、タッチとキーボードから到達できない。
        // 保存済みは常時、未保存はhover/フォーカス時に出す。
        className={cn(
          "mt-2 size-8 shrink-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100",
          article.saved ? "opacity-100" : "opacity-0 max-lg:opacity-60"
        )}
        onClick={() => onToggleSaved(article)}
        size="icon-sm"
        variant="ghost"
      >
        {article.saved ? (
          <BookmarkCheck aria-hidden="true" className="text-primary" />
        ) : (
          <Bookmark aria-hidden="true" className="text-muted-foreground/70" />
        )}
      </Button>
    </li>
  )
})

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
