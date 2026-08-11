import { Inbox, ListMusic, TriangleAlert } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import {
  articleTimestamp,
  publishedAtLabel,
  type Article,
} from "@/features/articles"

import { MAX_SELECTED_ARTICLES, selectionLabel } from "../model"

export type ArticlePickerDialogProps = {
  readonly open: boolean
  readonly articles: readonly Article[]
  readonly selected: ReadonlySet<string>
  readonly selectedCount: number
  readonly atLimit: boolean
  readonly isLoading?: boolean
  readonly isError?: boolean
  readonly hasNextPage?: boolean
  readonly isFetchingNextPage?: boolean
  readonly pending?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onToggle: (articleId: string) => void
  readonly onSelectTop: () => void
  readonly onClear: () => void
  readonly onLoadMore: () => void
  readonly onRetry: () => void
  readonly onConfirm: () => void
}

function PickerRow({
  article,
  checked,
  disabled,
  onToggle,
}: {
  readonly article: Article
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: (articleId: string) => void
}) {
  return (
    <li>
      <label
        className={cn(
          "flex min-h-14 cursor-pointer items-start gap-3 border-b px-3 py-2.5",
          "hover:bg-accent/50 has-focus-visible:bg-accent/50",
          checked && "bg-accent",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Checkbox
          checked={checked}
          className="mt-0.5 shrink-0"
          disabled={disabled}
          onCheckedChange={() => onToggle(article.id)}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{article.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{article.sourceName}</span>
            <time dateTime={articleTimestamp(article)}>
              {publishedAtLabel(articleTimestamp(article))}
            </time>
            {typeof article.relevanceScore === "number" ? (
              <span
                aria-label={`適合度スコア ${article.relevanceScore}`}
                className="font-medium text-foreground"
              >
                {article.relevanceScore}
              </span>
            ) : null}
          </span>
        </span>
      </label>
    </li>
  )
}

function PickerBody({
  articles,
  atLimit,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isLoading,
  onLoadMore,
  onRetry,
  onToggle,
  selected,
}: Pick<
  ArticlePickerDialogProps,
  | "articles"
  | "atLimit"
  | "hasNextPage"
  | "isError"
  | "isFetchingNextPage"
  | "isLoading"
  | "onLoadMore"
  | "onRetry"
  | "onToggle"
  | "selected"
>) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-10 w-full" key={index} />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>候補を読み込めませんでした</EmptyTitle>
          <EmptyDescription>
            通信状況を確認してから、もう一度お試しください。
          </EmptyDescription>
        </EmptyHeader>
        <Button onClick={onRetry} size="sm" variant="outline">
          再読み込み
        </Button>
      </Empty>
    )
  }

  if (articles.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>選べる記事がまだありません</EmptyTitle>
          <EmptyDescription>
            本文の取り込みが完了した記事だけを番組にできます。少し待ってから
            もう一度開いてください。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <ul className="flex flex-col">
        {articles.map((article) => {
          const checked = selected.has(article.id)
          return (
            <PickerRow
              article={article}
              checked={checked}
              disabled={atLimit && !checked}
              key={article.id}
              onToggle={onToggle}
            />
          )
        })}
      </ul>
      {hasNextPage ? (
        <div className="p-3">
          <Button
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
            size="sm"
            variant="outline"
          >
            {isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
            もっと読み込む
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** 生成前に対象記事を選ぶモーダル。選んだ記事だけが番組の題材になる。 */
export function ArticlePickerDialog({
  onConfirm,
  onOpenChange,
  onSelectTop,
  onClear,
  open,
  pending,
  selectedCount,
  ...body
}: ArticlePickerDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 p-0">
        <AlertDialogHeader className="border-b p-4">
          <AlertDialogTitle>番組にする記事を選ぶ</AlertDialogTitle>
          <AlertDialogDescription>
            選んだ記事だけを題材にします。最大{MAX_SELECTED_ARTICLES}件まで、
            おすすめ順に並んでいます。
          </AlertDialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              disabled={body.articles.length === 0}
              onClick={onSelectTop}
              size="sm"
              variant="outline"
            >
              上位{MAX_SELECTED_ARTICLES}件を選択
            </Button>
            <Button
              disabled={selectedCount === 0}
              onClick={onClear}
              size="sm"
              variant="ghost"
            >
              選択を解除
            </Button>
          </div>
        </AlertDialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <PickerBody {...body} />
        </div>

        <AlertDialogFooter className="flex-row items-center justify-between gap-3 border-t p-4">
          <span
            aria-live="polite"
            className="text-sm tabular-nums text-muted-foreground"
          >
            {selectionLabel(selectedCount)}
          </span>
          <div className="flex items-center gap-2">
            <AlertDialogCancel disabled={pending}>キャンセル</AlertDialogCancel>
            <Button
              disabled={selectedCount === 0 || pending}
              onClick={onConfirm}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ListMusic aria-hidden="true" data-icon="inline-start" />
              )}
              {pending ? "受付中…" : "この記事で生成"}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
