import { ArrowLeft, BookOpen } from "lucide-react"
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

import { useArticleKeyboardShortcuts } from "../-hooks/use-article-keyboard-shortcuts"
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

/**
 * データ接続。`key={articleId}`でマウントされる前提なので、記事が変わると
 * このインスタンスごと入れ替わる。ソース選択などのローカルstateは自然に初期化
 * され、開いていた未読記事のフラッシュもunmountのcleanupで完結する。
 */
export function ArticleReader({
  articleId,
  includeHidden,
  onBack,
}: {
  readonly articleId: string
  readonly includeHidden: boolean
  readonly onBack: () => void
}) {
  const reader = useArticleReader({ articleId, includeHidden })

  // 記事を開いている時だけ有効なショートカット。リーダーと寿命を揃える。
  useArticleKeyboardShortcuts({
    onOpenOriginal: () =>
      window.open(reader.article.url, "_blank", "noopener,noreferrer"),
    onToggleSaved: reader.toggleSaved,
    onToggleReadLater: reader.toggleReadLater,
    onMarkUnread: reader.markUnread,
  })

  return <ArticleReaderView {...reader} onBack={onBack} />
}

/** Panelのfallback。読み込み中も本文の骨格を保ち、切り替えで高さが飛ばない。 */
export function ReaderSkeleton() {
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

export function EmptySelection() {
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
  recalculateAi,
  isRecalculating,
  onBack,
}: ArticleReaderViewProps) {
  const focusRef = useSingleColumnReaderFocus(articleId)

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
