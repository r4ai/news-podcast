import { BookOpen } from "lucide-react"
import { useEffect, useRef } from "react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import {
  MarkdownToc,
  tocEntries,
  useActiveHeading,
  useCompiledMarkdown,
} from "@/shared/markdown"

import { useArticleKeyboardShortcuts } from "../-hooks/use-article-keyboard-shortcuts"
import { useArticleReader } from "../-hooks/use-article-reader"
import { articleMarkdownOptions } from "../-model"
import { ArticleActions } from "./article-actions"
import { ArticleAiBlock } from "./article-ai-block"
import { ArticleReaderContent } from "./article-reader-content"
import { ArticleReaderHeader } from "./article-reader-header"
import { ArticleSourceTabs } from "./article-source-tabs"
import { ArticleTocRail } from "./article-toc-rail"

export type ArticleReaderViewProps = ReturnType<typeof useArticleReader>

/**
 * データ接続。`key={articleId}`でマウントされる前提なので、記事が変わると
 * このインスタンスごと入れ替わる。ソース選択などのローカルstateは自然に初期化
 * され、開いていた未読記事のフラッシュもunmountのcleanupで完結する。
 */
export function ArticleReader({
  articleId,
  includeHidden,
}: {
  readonly articleId: string
  readonly includeHidden: boolean
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

  return <ArticleReaderView {...reader} />
}

/**
 * Panelのfallback。
 *
 * 骨組みは「取得を待っている部分」だけに掛ける。一覧へ戻る導線や余白のように
 * 取得を待たずに描けるものは境界の外にあり、ここには含めない。届く前と後で
 * 位置が動かない最小の骨格 (題名2行・出典・本文の書き出し) だけを置く。
 */
export function ReaderSkeleton() {
  return (
    <div
      aria-label="記事を読み込み中"
      className="flex w-full max-w-3xl flex-col gap-2"
      role="status"
    >
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="mt-1 h-3 w-32" />
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
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
          j / k で記事を送り、o で元記事を開けます。? で操作の一覧を出せます。
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
    // 位置は動かさない。focusに任せると、記事が画面へ収まらない時にブラウザが
    // 本文を見える所まで送り、上に居る「一覧へ戻る」が画面外へ押し出される。
    if (!twoColumn) ref.current?.focus({ preventScroll: true })
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
}: ArticleReaderViewProps) {
  const focusRef = useSingleColumnReaderFocus(articleId)

  // 目次を本文の外へ出すため、コンパイルはここで1度だけ行い、本文と目次へ
  // 同じ結果を配る(ADR-0018: hookが状態を持ち、viewはpropsのみ)。
  const compiled = useCompiledMarkdown(
    markdown ?? "",
    articleMarkdownOptions(article)
  )
  const outline =
    compiled.status === "ready" && source === "markdown" ? compiled.outline : []
  // 器を出すかどうかは`outline`ではなく「実際に並ぶ項目」で決める。見出しが
  // 1つだけの記事では目次自体が何も描かないので、空のdisclosureと幅だけ取る
  // レールが残ってしまう。
  const entries = tocEntries(outline)
  const activeHeadingId = useActiveHeading(outline)

  return (
    // 親は縦並びのスクロール領域なので、この枠の高さは中身の分に収まる。
    // 目次の追従(sticky)が動ける範囲は包む枠の中までなので、本文の長さが
    // そのまま追従できる長さになる。
    <div className="flex w-full gap-6">
      <article
        aria-label={article.title}
        className="flex w-full min-w-0 max-w-3xl flex-col gap-4 outline-none"
        ref={focusRef}
        tabIndex={-1}
      >
        <ArticleReaderHeader article={article} />

        {/*
          記事に対する操作は題名のすぐ下へ置く。幅で置き場所を変えない。
          以前は狭い幅だけ画面下端へ固定していたが、下端は下部ナビと再生バーの
          場所で、鳴らし始めるとそれらと重なって宙に浮いていた。
        */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ArticleSourceTabs onSourceChange={setSource} source={source} />
          <ArticleActions
            article={article}
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

        {/*
          右へ格納できるレールが入らない幅では、目次を本文の前に畳んで置く。
          開いたままだと記事を開くたびに本文が目次の分だけ下へ押される。
          畳んだ中身は`hidden="until-found"`で残るので、Ctrl+Fの検索にも掛かる。
        */}
        {entries.length > 0 ? (
          <MarkdownToc
            activeId={activeHeadingId}
            className="xl:hidden"
            defaultOpen={false}
            outline={outline}
          />
        ) : null}

        <ArticleReaderContent
          archiveHtml={archiveHtml}
          archiveUnavailable={archiveUnavailable}
          article={article}
          compiled={compiled}
          isArchiveLoading={isArchiveLoading}
          isMarkdownLoading={isMarkdownLoading}
          markdown={markdown}
          source={source}
        />
      </article>

      <ArticleTocRail activeId={activeHeadingId} entries={entries} />
    </div>
  )
}
