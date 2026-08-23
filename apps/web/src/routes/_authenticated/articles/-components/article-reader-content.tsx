import { MarkdownBody, type MarkdownCompileState } from "@/shared/markdown"
import { Button } from "@workspace/ui/components/button"
import { useEffect, useRef, useState } from "react"
import type { Article, ArticleSource } from "../-model"

export type ArticleReaderContentProps = {
  readonly article: Article
  readonly source: ArticleSource
  readonly markdown: string | undefined
  readonly isMarkdownLoading: boolean
  /** リーダー側で1度だけコンパイルした本文。目次と同じ結果を共有する。 */
  readonly compiled: MarkdownCompileState
  readonly archiveUrl: string | undefined
  readonly isArchiveLoading: boolean
  readonly archiveUnavailable: boolean
  readonly retryArchive: () => void
  readonly useMarkdown: () => void
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

function ArchiveUnavailableNotice({
  article,
  canUseMarkdown,
  retryArchive,
  useMarkdown,
}: {
  readonly article: Article
  readonly canUseMarkdown: boolean
  readonly retryArchive: () => void
  readonly useMarkdown: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      <p>保存版を読み込めませんでした。</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={retryArchive} size="sm" variant="outline">
          再試行
        </Button>
        {canUseMarkdown ? (
          <Button onClick={useMarkdown} size="sm" variant="ghost">
            本文表示に戻る
          </Button>
        ) : null}
      </div>
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
  compiled,
  archiveUrl,
  isArchiveLoading,
  archiveUnavailable,
  retryArchive,
  useMarkdown,
}: ArticleReaderContentProps) {
  const [archiveLoadFailed, setArchiveLoadFailed] = useState(false)
  const [archiveAttempt, setArchiveAttempt] = useState(0)
  const archiveFrameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const frame = archiveFrameRef.current
    if (frame === null) return
    const reportFailure = () => setArchiveLoadFailed(true)
    frame.addEventListener("error", reportFailure)
    return () => frame.removeEventListener("error", reportFailure)
  }, [archiveUrl, archiveAttempt])

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
    if (archiveUnavailable || archiveLoadFailed || !archiveUrl) {
      return (
        <ArchiveUnavailableNotice
          article={article}
          canUseMarkdown={Boolean(markdown)}
          retryArchive={() => {
            setArchiveLoadFailed(false)
            setArchiveAttempt((attempt) => attempt + 1)
            retryArchive()
          }}
          useMarkdown={useMarkdown}
        />
      )
    }
    return (
      <iframe
        className="h-[70vh] w-full rounded-lg border"
        key={`${archiveUrl}:${archiveAttempt}`}
        ref={archiveFrameRef}
        sandbox=""
        src={archiveUrl}
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
  return <MarkdownBody state={compiled} />
}
