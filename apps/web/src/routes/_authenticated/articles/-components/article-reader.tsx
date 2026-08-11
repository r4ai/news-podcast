import { ArrowLeft, BookOpen, SearchX } from "lucide-react"

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
      className="flex w-full flex-col gap-4"
      role="status"
    >
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function EmptySelection() {
  return (
    <Empty className="h-full w-full border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpen aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>記事を選ぶと、ここに本文が表示されます</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

function LoadFailure() {
  return (
    <Empty className="h-full w-full border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>記事を取得できませんでした</EmptyTitle>
        <EmptyDescription>
          一覧へ戻ってもう一度お試しください。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
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
  onBack,
}: ArticleReaderViewProps) {
  if (!articleId) return <EmptySelection />
  if (isLoading) return <ReaderSkeleton />
  if (isError || !article) return <LoadFailure />

  return (
    <div className="flex w-full flex-col gap-4 pb-20 lg:pb-4">
      <Button
        className="self-start lg:hidden"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <ArrowLeft data-icon="inline-start" />
        一覧へ戻る
      </Button>

      <ArticleReaderHeader article={article} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ArticleSourceTabs onSourceChange={setSource} source={source} />
        <ArticleActions
          article={article}
          className="hidden lg:flex"
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

      <ArticleAiBlock article={article} />

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
        className="fixed inset-x-0 bottom-0 z-10 justify-center border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden"
        onToggleHidden={toggleHidden}
        onToggleReadLater={toggleReadLater}
        onToggleSaved={toggleSaved}
      />
    </div>
  )
}
