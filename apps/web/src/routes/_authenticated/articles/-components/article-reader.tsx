import { ArrowLeft, BookOpen, SearchX } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useArticleReader } from "../-hooks/use-article-reader"
import { ArticleActions } from "./article-actions"
import { ArticleAiBlock } from "./article-ai-block"
import { ArticleReaderContent } from "./article-reader-content"
import { ArticleReaderHeader } from "./article-reader-header"
import { ArticleSourceTabs } from "./article-source-tabs"

export type ArticleReaderViewProps = ReturnType<typeof useArticleReader> & {
  /** モバイルの「一覧へ戻る」導線。 */
  readonly onBack: () => void
}

function ReaderSkeleton() {
  return (
    <div
      aria-label="記事を読み込み中"
      className="flex w-full max-w-3xl flex-col gap-4"
      role="status"
    >
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function EmptySelection() {
  return (
    <Empty className="h-full w-full rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpen aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>記事を選ぶと、ここに本文が表示されます</EmptyTitle>
        <EmptyDescription>
          j / k で記事を送り、o で元記事を開けます。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LoadFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Empty className="h-full w-full rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>記事を取得できませんでした</EmptyTitle>
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

/**
 * 1カラム時 (lg未満) は記事を開くと一覧が画面から消えるので、
 * 読み上げとキーボードの現在地を本文へ移す。
 * 2カラム時は一覧に留まったままj/kで送れるよう、フォーカスを奪わない。
 */
function useSingleColumnReaderFocus(articleId: string | undefined) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (articleId === undefined) return
    const twoColumn = window.matchMedia?.("(min-width: 64rem)").matches ?? true
    if (!twoColumn) ref.current?.focus()
  }, [articleId])

  return ref
}

/** 選択中記事の本文リーダー。ソース切り替え・AIブロック・操作列をまとめる。 */
export function ArticleReaderView({
  articleId,
  article,
  isLoading,
  isError,
  source,
  setSource,
  didAutoFallback,
  markdown,
  isMarkdownLoading,
  archiveHtml,
  isArchiveLoading,
  archiveUnavailable,
  toggleSaved,
  toggleReadLater,
  toggleHidden,
  refetch,
  recalculateAi,
  isRecalculating,
  onBack,
}: ArticleReaderViewProps) {
  const focusRef = useSingleColumnReaderFocus(articleId)

  if (!articleId) return <EmptySelection />
  if (isLoading) return <ReaderSkeleton />
  if (isError || !article) return <LoadFailure onRetry={refetch} />

  return (
    // 下端の固定操作列と下部ナビはどちらもmdで消えるので、余白もmdで戻す。
    <article
      aria-label={article.title}
      className="flex w-full max-w-3xl flex-col gap-4 pb-24 outline-none md:pb-4"
      ref={focusRef}
      tabIndex={-1}
    >
      <Button
        className="self-start lg:hidden"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        一覧へ戻る
      </Button>

      <ArticleReaderHeader article={article} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ArticleSourceTabs onSourceChange={setSource} source={source} />
        <ArticleActions
          article={article}
          className="hidden md:flex"
          onToggleHidden={toggleHidden}
          onToggleReadLater={toggleReadLater}
          onToggleSaved={toggleSaved}
        />
      </div>

      {didAutoFallback ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          本文が短いため、アーカイブ表示に切り替えました。
        </p>
      ) : null}

      <ArticleAiBlock
        article={article}
        isRecalculating={isRecalculating}
        onRecalculate={recalculateAi}
      />

      <ArticleReaderContent
        archiveHtml={archiveHtml}
        archiveUnavailable={archiveUnavailable}
        article={article}
        isArchiveLoading={isArchiveLoading}
        isMarkdownLoading={isMarkdownLoading}
        markdown={markdown}
        source={source}
      />

      <ArticleActions
        article={article}
        className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-10 justify-center border-t bg-background/95 p-3 backdrop-blur md:hidden"
        onToggleHidden={toggleHidden}
        onToggleReadLater={toggleReadLater}
        onToggleSaved={toggleSaved}
      />
    </article>
  )
}
