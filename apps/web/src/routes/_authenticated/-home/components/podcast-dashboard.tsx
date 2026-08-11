import {
  AlertTriangle,
  Clock3,
  Library,
  ListMusic,
  RotateCcw,
  Rss,
  Square,
} from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"

import { PageHeader } from "@/shared/layouts/page-header"

import type { AdoptedArticle, TimelineEntry } from "../model"
import { AgentTimeline } from "./agent-timeline"

export type DashboardState =
  | "ready"
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "canceled"

export type PodcastDashboardProps = {
  readonly state?: DashboardState
  readonly pending?: boolean
  readonly attempt?: number
  readonly maxAttempts?: number
  readonly stage?: string
  readonly progress?: number
  readonly stageProgress?: {
    readonly completed: number
    readonly total: number
  }
  readonly lastProgressAt?: string
  readonly deadlineAt?: string
  readonly retryAt?: string
  readonly failure?: string
  readonly episode?: {
    readonly title: string
    readonly createdAt: string
    readonly sourceCount: number
  }
  readonly schedule?: {
    readonly enabled: boolean
    readonly localTime: string
    readonly timeZone: string
  }
  readonly subscriptionNames?: readonly string[]
  readonly timeline?: readonly TimelineEntry[]
  readonly adoptedArticles?: readonly AdoptedArticle[]
  readonly streaming?: boolean
  readonly onGenerate?: () => void
  readonly onCancel?: () => void
  readonly onRetry?: () => void
}

const statusCopy: Record<
  DashboardState,
  {
    readonly label: string
    readonly title: string
    readonly description: string
  }
> = {
  ready: {
    label: "準備完了",
    title: "番組を生成できます",
    description: "題材にする記事を選んでから生成を開始します。",
  },
  queued: {
    label: "待機中",
    title: "生成を受け付けました",
    description: "Workerが処理を開始するまでお待ちください。",
  },
  running: {
    label: "生成中",
    title: "番組を生成しています",
    description: "RSSの取得、要約、音声化を順番に進めています。",
  },
  retrying: {
    label: "再試行待ち",
    title: "生成を再試行します",
    description: "一時的な問題が解消され次第、自動的に再開します。",
  },
  succeeded: {
    label: "完成",
    title: "今日の番組が完成しました",
    description: "最新のエピソードと参照した出典を確認できます。",
  },
  failed: {
    label: "失敗",
    title: "番組を生成できませんでした",
    description: "記事を選び直して、別の条件で再生成できます。",
  },
  canceled: {
    label: "キャンセル",
    title: "生成はキャンセルされました",
    description: "必要であれば新しい生成を開始できます。",
  },
}

const activeStates = new Set<DashboardState>(["queued", "running", "retrying"])

function StatusDetails({
  failure,
  deadlineAt,
  lastProgressAt,
  progress,
  retryAt,
  stage,
  stageProgress,
}: Pick<
  PodcastDashboardProps,
  | "failure"
  | "deadlineAt"
  | "lastProgressAt"
  | "progress"
  | "retryAt"
  | "stage"
  | "stageProgress"
>) {
  return (
    <>
      {stage && progress !== undefined ? (
        <Progress aria-label="番組生成の進捗" value={progress}>
          <ProgressLabel>{stage}</ProgressLabel>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </Progress>
      ) : null}
      {stageProgress ? (
        <p className="text-sm tabular-nums text-muted-foreground">
          音声chunk: {stageProgress.completed}/{stageProgress.total}
        </p>
      ) : null}
      {lastProgressAt ? (
        <p className="text-sm text-muted-foreground">
          最終進捗: {new Date(lastProgressAt).toLocaleString("ja-JP")}
        </p>
      ) : null}
      {deadlineAt ? (
        <p className="text-sm text-muted-foreground">
          完了期限: {new Date(deadlineAt).toLocaleString("ja-JP")}
        </p>
      ) : null}
      {retryAt ? (
        <p className="text-sm text-muted-foreground">
          再試行予定: {new Date(retryAt).toLocaleTimeString("ja-JP")}
        </p>
      ) : null}
      {failure ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>生成エラー</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

function GenerationAction({
  active,
  attempt,
  maxAttempts = 4,
  onCancel,
  onGenerate,
  onRetry,
  pending,
  state,
}: Pick<
  PodcastDashboardProps,
  | "attempt"
  | "maxAttempts"
  | "onCancel"
  | "onGenerate"
  | "onRetry"
  | "pending"
  | "state"
> & {
  readonly active: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">
        {attempt === undefined
          ? "まだ生成していません"
          : `試行 ${attempt}/${maxAttempts}`}
      </span>
      {active ? (
        <Button
          className="min-h-11 min-w-32 sm:min-h-9"
          disabled={pending || !onCancel}
          onClick={onCancel}
          variant="destructive"
        >
          {pending ? <Spinner data-icon="inline-start" /> : <Square />}
          {pending ? "停止中…" : "生成を停止"}
        </Button>
      ) : state === "failed" ? (
        <Button
          className="min-h-11 min-w-32 sm:min-h-9"
          disabled={pending || !onRetry}
          onClick={onRetry}
        >
          {pending ? <Spinner data-icon="inline-start" /> : <RotateCcw />}
          {pending ? "受付中…" : "記事を選び直して再生成"}
        </Button>
      ) : (
        <Button
          className="min-h-11 min-w-32 sm:min-h-9"
          disabled={pending || !onGenerate}
          onClick={onGenerate}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ListMusic aria-hidden="true" data-icon="inline-start" />
          )}
          {pending ? "受付中…" : "番組を生成"}
        </Button>
      )}
    </div>
  )
}

function GenerationStatus({
  attempt,
  deadlineAt,
  failure,
  lastProgressAt,
  maxAttempts,
  onCancel,
  onGenerate,
  onRetry,
  pending,
  progress,
  retryAt,
  stage,
  stageProgress,
  state = "ready",
}: PodcastDashboardProps) {
  const copy = statusCopy[state]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>生成ステータス</h2>
        </CardTitle>
        <CardDescription>{copy.title}</CardDescription>
        <CardAction>
          <Badge variant={state === "failed" ? "destructive" : "secondary"}>
            {copy.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
        <StatusDetails
          failure={failure}
          deadlineAt={deadlineAt}
          lastProgressAt={lastProgressAt}
          progress={progress}
          retryAt={retryAt}
          stage={stage}
          stageProgress={stageProgress}
        />
        <GenerationAction
          active={activeStates.has(state)}
          attempt={attempt}
          maxAttempts={maxAttempts}
          onCancel={onCancel}
          onGenerate={onGenerate}
          onRetry={onRetry}
          pending={pending}
          state={state}
        />
      </CardContent>
    </Card>
  )
}

function LatestEpisode({ episode }: Pick<PodcastDashboardProps, "episode">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>最新エピソード</h2>
        </CardTitle>
        <CardDescription>完成した音声と出典を確認できます。</CardDescription>
        <CardAction>
          <a
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href="/library"
          >
            すべて見る
          </a>
        </CardAction>
      </CardHeader>
      <CardContent>
        {episode ? (
          <div className="flex flex-col gap-1">
            <p className="font-medium">{episode.title}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(episode.createdAt).toLocaleString("ja-JP")} ・ 出典
              {episode.sourceCount}件
            </p>
          </div>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Library aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>完成した番組はまだありません</EmptyTitle>
              <EmptyDescription>
                生成が完了すると、音声と出典がここに表示されます。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

function SettingsSummary({
  schedule,
  subscriptionNames = [],
}: Pick<PodcastDashboardProps, "schedule" | "subscriptionNames">) {
  return (
    <aside aria-label="購読と生成設定" className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Clock3 aria-hidden="true" />
              生成時刻
            </h2>
          </CardTitle>
          <CardAction>
            <a
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href="/schedule"
            >
              変更
            </a>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="font-medium">
            {schedule?.enabled
              ? `毎日 ${schedule.localTime}`
              : "自動生成はオフ"}
          </p>
          {schedule ? (
            <p className="text-sm text-muted-foreground">{schedule.timeZone}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Rss aria-hidden="true" />
              購読フィード
            </h2>
          </CardTitle>
          <CardDescription>
            {subscriptionNames.length}件を購読中
          </CardDescription>
          <CardAction>
            <a
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href="/subscriptions"
            >
              管理
            </a>
          </CardAction>
        </CardHeader>
        <CardContent>
          {subscriptionNames.length > 0 ? (
            <ul className="flex flex-col text-sm">
              {subscriptionNames.map((name, index) => (
                <li className="flex flex-col gap-3" key={name}>
                  {index > 0 ? <Separator /> : null}
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">購読はありません。</p>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

export function PodcastDashboard(props: PodcastDashboardProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="購読中のRSSから、出典を確認できる音声番組を生成します。"
        title="今日のニュース番組"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <GenerationStatus {...props} />
          <AgentTimeline
            adoptedArticles={props.adoptedArticles ?? []}
            streaming={props.streaming}
            timeline={props.timeline ?? []}
          />
          <LatestEpisode episode={props.episode} />
        </div>
        <SettingsSummary
          schedule={props.schedule}
          subscriptionNames={props.subscriptionNames}
        />
      </div>
    </div>
  )
}
