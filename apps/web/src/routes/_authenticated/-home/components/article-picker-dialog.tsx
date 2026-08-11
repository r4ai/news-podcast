import { Inbox, ListMusic, Search, TriangleAlert } from "lucide-react"
import { useDeferredValue, useEffect, useState } from "react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
import { Input } from "@workspace/ui/components/input"
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
  readonly submitError?: string
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
  const snippet = article.summary
  return (
    <li>
      <label
        className={cn(
          "flex min-h-16 cursor-pointer items-start gap-2.5 border-b px-3 py-2",
          "hover:bg-accent/50 has-focus-visible:bg-accent/50",
          checked && "bg-accent",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Checkbox
          checked={checked}
          className="mt-1 shrink-0"
          disabled={disabled}
          onCheckedChange={() => onToggle(article.id)}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-sm leading-5 font-medium">
            {article.title}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{article.sourceName}</span>
            <time dateTime={articleTimestamp(article)}>
              {publishedAtLabel(articleTimestamp(article))}
            </time>
            {typeof article.relevanceScore === "number" ? (
              <Badge
                aria-label={`適合度スコア ${article.relevanceScore}`}
                className="ml-auto shrink-0 tabular-nums"
                variant="outline"
              >
                {article.relevanceScore}
              </Badge>
            ) : null}
          </span>
          {snippet ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {snippet}
            </span>
          ) : null}
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
  hasUnfilteredArticles,
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
> & { readonly hasUnfilteredArticles: boolean }) {
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
          <EmptyTitle>
            {hasUnfilteredArticles
              ? "検索に一致する記事がありません"
              : "選べる記事がまだありません"}
          </EmptyTitle>
          <EmptyDescription>
            {hasUnfilteredArticles
              ? "検索語を変えると、ほかの候補を表示できます。"
              : "本文の取り込みが完了した記事だけを番組にできます。少し待ってからもう一度開いてください。"}
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
  submitError,
  ...body
}: ArticlePickerDialogProps) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("ja"))
  const filteredArticles = deferredQuery
    ? body.articles.filter((article) =>
        [article.title, article.sourceName, ...article.tags].some((value) =>
          value.toLocaleLowerCase("ja").includes(deferredQuery)
        )
      )
    : body.articles

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <DialogTitle>番組にする記事を選ぶ</DialogTitle>
              <DialogDescription>
                選んだ記事だけを題材にします。最大{MAX_SELECTED_ARTICLES}
                件まで、おすすめ順に並んでいます。
              </DialogDescription>
            </div>
            <Badge className="shrink-0 tabular-nums" variant="secondary">
              {selectedCount}/{MAX_SELECTED_ARTICLES}
            </Badge>
          </div>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="候補記事を検索"
                className="pl-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="タイトル・媒体・タグで絞り込み"
                role="searchbox"
                value={query}
              />
            </div>
            <Button
              disabled={body.articles.length === 0}
              onClick={onSelectTop}
              size="sm"
              variant="outline"
            >
              おすすめを一括選択
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
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {submitError ? (
            <div className="p-3">
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <PickerBody
            {...body}
            articles={filteredArticles}
            hasUnfilteredArticles={body.articles.length > 0}
          />
        </div>

        <DialogFooter className="m-0 flex-col gap-3 rounded-none border-t p-4 sm:flex-row sm:items-center sm:justify-between">
          <span
            aria-live="polite"
            className="text-sm tabular-nums text-muted-foreground"
          >
            {selectionLabel(selectedCount)}
          </span>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <DialogClose className="flex-1 sm:flex-none" disabled={pending}>
              キャンセル
            </DialogClose>
            <Button
              className="flex-1 sm:flex-none"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
