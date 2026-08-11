import { Check, ExternalLink, Radio, Wrench } from "lucide-react"

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

export type AgentTimelineProps = {
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
          {entry.kind === "tool" ? (
            <Wrench
              aria-hidden="true"
              className="size-3 text-muted-foreground"
            />
          ) : null}
          <span
            className={cn(
              "truncate",
              entry.done ? "text-muted-foreground" : "font-medium"
            )}
          >
            {entry.label}
          </span>
        </span>
        {entry.kind === "tool" && entry.args ? (
          <code className="truncate font-mono text-xs text-muted-foreground">
            {entry.args}
          </code>
        ) : null}
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
              <span className="truncate text-sm">{article.title}</span>
              <span className="text-xs text-muted-foreground">
                {article.sourceName}
              </span>
            </span>
            <a
              aria-label={`${article.title} を元記事で開く`}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
              href={article.url}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * エージェントの作業実況。AG-UIイベントを畳み込んだ結果を並べるだけの
 * presentational component。
 */
export function AgentTimeline({
  adoptedArticles,
  streaming,
  timeline,
}: AgentTimelineProps) {
  if (timeline.length === 0 && adoptedArticles.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>エージェントの作業</h2>
        </CardTitle>
        <CardDescription>
          何を読み、何を調べているかをそのまま表示します。
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
            <TimelineRow
              entry={entry}
              key={entry.kind === "tool" ? entry.toolCallId : entry.stepName}
            />
          ))}
        </ol>
        <AdoptedArticles articles={adoptedArticles} />
      </CardContent>
    </Card>
  )
}
