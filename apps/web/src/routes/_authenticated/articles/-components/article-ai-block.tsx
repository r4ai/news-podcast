import { RefreshCw, Sparkles } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { Markdown } from "@/shared/markdown"

import { hasAiEnrichment, type Article } from "../-model"

export type ArticleAiBlockProps = {
  readonly article: Article
  /** 明示的なAI再計算（POST /enrich）。処理済み記事の再スコアリング。 */
  readonly onRecalculate: () => void
  readonly isRecalculating: boolean
}

/** Markdown要約を表示し、関連度が生成済みの場合だけスコアと理由を添える。 */
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
        {typeof article.relevanceScore === "number" ? (
          <div className="flex items-center gap-2">
            <Progress
              aria-label="適合度"
              className="w-20"
              value={article.relevanceScore}
            />
            <span className="text-xs text-muted-foreground">
              {article.relevanceScore}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">適合度未計算</span>
        )}
      </div>

      <div className="text-sm">
        <Markdown markdown={article.aiSummary!} />
      </div>

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
