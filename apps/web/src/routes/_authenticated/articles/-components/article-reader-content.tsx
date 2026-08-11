import { Markdown } from "@/shared/markdown"
import { articleBaseUrl, type Article, type ArticleSource } from "../-model"

export type ArticleReaderContentProps = {
  readonly article: Article
  readonly source: ArticleSource
  readonly markdown: string | undefined
  readonly isMarkdownLoading: boolean
  readonly archiveHtml: string | undefined
  readonly isArchiveLoading: boolean
  readonly archiveUnavailable: boolean
}

function NoContentNotice({ article }: { readonly article: Article }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      <p>本文もアーカイブも利用できません。</p>
      <a
        className="text-primary underline underline-offset-4"
        href={article.url}
        rel="noreferrer"
        target="_blank"
      >
        元記事を新しいタブで開く
      </a>
    </div>
  )
}

/** 表示ソースに応じて本文/アーカイブ/どちらも無い場合を出し分ける。 */
export function ArticleReaderContent({
  article,
  source,
  markdown,
  isMarkdownLoading,
  archiveHtml,
  isArchiveLoading,
  archiveUnavailable,
}: ArticleReaderContentProps) {
  if (source === "archive") {
    if (isArchiveLoading) {
      return (
        <div
          aria-label="アーカイブを読み込み中"
          className="h-[60vh] animate-pulse rounded-lg border bg-muted/40"
          role="status"
        />
      )
    }
    if (archiveUnavailable || !archiveHtml) {
      return <NoContentNotice article={article} />
    }
    return (
      <iframe
        className="h-[70vh] w-full rounded-lg border"
        sandbox=""
        srcDoc={archiveHtml}
        title={article.title}
      />
    )
  }

  if (isMarkdownLoading) {
    return (
      <div
        aria-label="本文を読み込み中"
        className="h-[60vh] animate-pulse rounded-lg border bg-muted/40"
        role="status"
      />
    )
  }
  if (!markdown) {
    return <NoContentNotice article={article} />
  }
  return <Markdown baseUrl={articleBaseUrl(article.id)} markdown={markdown} />
}
