import {
  AlertTriangle,
  Library,
  ListMusic,
  Play,
  RotateCcw,
  Square,
} from "lucide-react"
import type { ReactNode } from "react"

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
import { Spinner } from "@workspace/ui/components/spinner"

import { PageHeader } from "@/shared/layouts/page-header"

export type DashboardState =
  | "ready"
  | "queued"
  | "running"
  | "retrying"
  | "projecting"
  | "projection-failed"
  | "succeeded"
  | "failed"
  | "canceled"

export type PodcastDashboardProps = {
  readonly state?: DashboardState
  readonly scheduleStatus?: "retrying" | "succeeded" | "missed"
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
  readonly retryLabel?: string
  readonly failure?: string
  readonly episode?: {
    readonly id: string
    readonly title: string
    readonly createdAt: string
    readonly sourceCount: number
  }
  /** 最新の番組を下端のバーで鳴らす。実際の再生はplayer featureが持つ。 */
  readonly onPlayEpisode?: () => void
  readonly onGenerate?: () => void
  readonly onCancel?: () => void
  readonly onRetry?: () => void
  readonly onRetryProjection?: () => void
  /** 作業実況。SSEを購読するのはこの中だけ。 */
  readonly timelineSlot?: ReactNode
  /** 生成時刻と購読フィードの要約。独自の取得と表示境界を持つ。 */
  readonly settingsSlot?: ReactNode
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
  projecting: {
    label: "準備中",
    title: "完成した番組を準備しています",
    description: "音声と出典を再生できる状態になるまで確認しています。",
  },
  "projection-failed": {
    label: "確認待ち",
    title: "完成した番組を確認できませんでした",
    description: "生成は完了しています。時間をおいて番組を再確認してください。",
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
const scheduleStatusLabels = {
  retrying: "日次予約: 再調整中",
  succeeded: "日次予約: 完了",
  missed: "日次予約: 未達",
} as const

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
  onRetryProjection,
  pending,
  retryLabel = "再試行",
  state,
}: Pick<
  PodcastDashboardProps,
  | "attempt"
  | "maxAttempts"
  | "onCancel"
  | "onGenerate"
  | "onRetry"
  | "onRetryProjection"
  | "pending"
  | "retryLabel"
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
      {state === "projecting" ? (
        <Button className="min-h-11 min-w-32 sm:min-h-9" disabled>
          <Spinner aria-hidden="true" data-icon="inline-start" />
          番組を準備中…
        </Button>
      ) : state === "projection-failed" ? (
        <Button
          className="min-h-11 min-w-32 sm:min-h-9"
          disabled={pending || !onRetryProjection}
          onClick={onRetryProjection}
        >
          {pending ? (
            <Spinner aria-hidden="true" data-icon="inline-start" />
          ) : (
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
          )}
          {pending ? "確認中…" : "番組を再確認"}
        </Button>
      ) : active ? (
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
          {pending ? "受付中…" : retryLabel}
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
  onRetryProjection,
  pending,
  progress,
  retryAt,
  retryLabel,
  scheduleStatus,
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
          <Badge
            variant={
              state === "failed" || state === "projection-failed"
                ? "destructive"
                : "secondary"
            }
          >
            {copy.label}
          </Badge>
        </CardAction>
      </CardHeader>
      {/*
        生成は数分かけて状態が移る。画面を見ていない利用者にも進行が届くよう、
        状態を表す文言と進捗をまとめて読み上げ対象にする。`polite`なので
        操作を遮らず、区切りのよいところで読まれる。
      */}
      <CardContent
        aria-live="polite"
        className="flex flex-col gap-4"
        role="status"
      >
        {scheduleStatus ? (
          <p className="text-sm font-medium">
            {scheduleStatusLabels[scheduleStatus]}
          </p>
        ) : null}
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
          onRetryProjection={onRetryProjection}
          pending={pending}
          retryLabel={retryLabel}
          state={state}
        />
      </CardContent>
    </Card>
  )
}

function LatestEpisode({
  episode,
  onPlayEpisode,
}: Pick<PodcastDashboardProps, "episode" | "onPlayEpisode">) {
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{episode.title}</p>
              <p className="text-sm text-muted-foreground">
                {new Date(episode.createdAt).toLocaleString("ja-JP")} ・ 出典
                {episode.sourceCount}件
              </p>
            </div>
            <Button
              className="min-h-11 sm:min-h-9"
              disabled={!onPlayEpisode}
              onClick={onPlayEpisode}
            >
              <Play aria-hidden="true" data-icon="inline-start" />
              再生
            </Button>
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

/**
 * 作業実況と設定要約は**slot**で受け取る。
 *
 * どちらも別の情報源を持つ (前者はSSE、後者は設定・購読・フィードの3query)。
 * このcomponentが直接読むと、その更新のたびに生成ステータスと最新エピソード
 * まで描き直され、初回表示も全部が揃うまで出せなくなる。propsだけを受け取る
 * 約束は保ったまま、購読と表示境界を差し込む側へ預ける (ADR-0060)。
 */
export function PodcastDashboard({
  settingsSlot,
  timelineSlot,
  ...props
}: PodcastDashboardProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="購読中のRSSから、出典を確認できる音声番組を生成します。"
        title="今日のニュース番組"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <GenerationStatus {...props} />
          {timelineSlot}
          <LatestEpisode
            episode={props.episode}
            onPlayEpisode={props.onPlayEpisode}
          />
        </div>
        {settingsSlot}
      </div>
    </div>
  )
}
