import { RefreshCw, Sparkles } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"

import { hasAiEnrichment, type Article } from "../-model"

export type ArticleAiBlockProps = {
  readonly article: Article
  /** 明示的なAI再計算（POST /enrich）。処理済み記事の再スコアリング。 */
  readonly onRecalculate: () => void
  readonly isRecalculating: boolean
}

/** 要約3点 + 理由 + 適合度。未処理の記事(フィールドが無い)では何も出さない。 */
export function ArticleAiBlock({
  article,
  onRecalculate,
  isRecalculating,
}: ArticleAiBlockProps) {
  if (!hasAiEnrichment(article)) return null

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3.5" />
          AI要約
        </div>
        <div className="flex items-center gap-2">
          <Progress
            aria-label="適合度"
            className="w-20"
            value={article.relevanceScore ?? null}
          />
          <span className="text-xs text-muted-foreground">
            {article.relevanceScore}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {article.aiSummary?.map((point, index) => (
          <li className="flex gap-2" key={index}>
            <span aria-hidden="true" className="text-muted-foreground">
              •
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ul>

      {article.relevanceReason ? (
        <p className="text-xs text-muted-foreground">
          {article.relevanceReason}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          className="self-start px-0 text-xs"
          disabled={isRecalculating}
          onClick={onRecalculate}
          size="sm"
          variant="link"
        >
          {isRecalculating ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {isRecalculating ? "再計算中…" : "AIで再計算"}
        </Button>
        <Button
          className="self-start px-0 text-xs"
          onClick={() =>
            toast.info("興味プロフィールの調整はまもなく利用できます")
          }
          size="sm"
          variant="link"
        >
          興味プロフィールを調整
        </Button>
      </div>
    </div>
  )
}
