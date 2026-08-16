import { Check, Radio } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import type { AdoptedArticle, TimelineEntry } from "../model"

export type GenerationTimelineProps = {
  readonly timeline: readonly TimelineEntry[]
  readonly adoptedArticles: readonly AdoptedArticle[]
  /** SSEが繋がっているか。切れていればライブ表示だと言い張らない。 */
  readonly streaming?: boolean
}

function EntryIcon({ done }: { readonly done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
        done
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-dashed bg-background text-muted-foreground"
      )}
    >
      {done ? (
        <Check className="size-3" />
      ) : (
        <Spinner className="size-3 text-muted-foreground" />
      )}
    </span>
  )
}

function TimelineRow({ entry }: { readonly entry: TimelineEntry }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* 縦線。最後の行では消して、線が宙に浮かないようにする。 */}
      <span
        aria-hidden="true"
        className="absolute left-2.5 top-6 h-[calc(100%-1.25rem)] w-px bg-border last:hidden"
      />
      <EntryIcon done={entry.done} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "truncate",
              entry.done ? "text-muted-foreground" : "font-medium"
            )}
          >
            {entry.label}
          </span>
        </span>
      </div>
    </li>
  )
}

function AdoptedArticles({
  articles,
}: {
  readonly articles: readonly AdoptedArticle[]
}) {
  if (articles.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <p className="text-xs font-medium text-muted-foreground">
        採用した記事 {articles.length}件
      </p>
      <ul className="flex flex-col gap-1.5">
        {articles.map((article) => (
          <li
            className="flex min-w-0 items-start gap-2"
            key={article.articleId}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                {article.title ?? article.articleId}
              </span>
              <span className="text-xs text-muted-foreground">
                {article.sourceName ?? "記事情報を取得中"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Podcast生成の作業実況。AG-UIイベントを畳み込んだ結果を並べるだけの
 * presentational component。
 */
export function GenerationTimeline({
  adoptedArticles,
  streaming,
  timeline,
}: GenerationTimelineProps) {
  if (timeline.length === 0 && adoptedArticles.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Podcast生成の進捗</h2>
        </CardTitle>
        <CardDescription>
          記事選定から音声保存までの段階を表示します。
        </CardDescription>
        {streaming ? (
          <CardAction>
            <Badge variant="secondary">
              <Radio aria-hidden="true" className="size-3" />
              ライブ
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col">
          {timeline.map((entry) => (
            <TimelineRow entry={entry} key={entry.stepName} />
          ))}
        </ol>
        <AdoptedArticles articles={adoptedArticles} />
      </CardContent>
    </Card>
  )
}
