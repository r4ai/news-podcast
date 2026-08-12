import { Lightbulb, RefreshCw, Sparkles } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { Markdown } from "@/shared/markdown"

import { hasAiEnrichment, type Article } from "../-model"

export type ArticleAiBlockProps = {
  readonly article: Article
  readonly onRecalculate: () => void
  readonly isRecalculating: boolean
}

function scoreLabel(
  score: number
): { label: string; className: string } {
  if (score >= 70)
    return {
      label: "高適合",
      className: "text-emerald-600 [&_[data-slot=progress-indicator]]:bg-emerald-500",
    }
  if (score >= 40)
    return {
      label: "中適合",
      className: "text-amber-600 [&_[data-slot=progress-indicator]]:bg-amber-500",
    }
  return {
    label: "低適合",
    className: "text-muted-foreground [&_[data-slot=progress-indicator]]:bg-muted-foreground/40",
  }
}

export function ArticleAiBlock({
  article,
  onRecalculate,
  isRecalculating,
}: ArticleAiBlockProps) {
  if (!hasAiEnrichment(article)) return null

  const hasScore = typeof article.relevanceScore === "number"

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3.5" />
          AI要約
        </div>
        {hasScore ? (
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                scoreLabel(article.relevanceScore!).className
              )}
            >
              {scoreLabel(article.relevanceScore!).label}{" "}
              {article.relevanceScore}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">適合度未計算</span>
        )}
      </div>

      {hasScore ? (
        <Progress
          aria-label={`適合度 ${article.relevanceScore}`}
          className={cn(scoreLabel(article.relevanceScore!).className)}
          value={article.relevanceScore ?? null}
        />
      ) : null}

      <div className="text-sm">
        <Markdown markdown={article.aiSummary!} />
      </div>

      {article.relevanceReason ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lightbulb aria-hidden="true" className="mt-px size-3 shrink-0" />
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
