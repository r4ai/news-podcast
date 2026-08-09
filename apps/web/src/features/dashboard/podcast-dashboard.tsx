import {
  Clock3,
  Headphones,
  House,
  Library,
  ListMusic,
  Rss,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export type DashboardState = "ready" | "running" | "succeeded"

type PodcastDashboardProps = {
  state?: DashboardState
  onGenerate?: () => void
}

const navigationItems = [
  { href: "#today", label: "今日", icon: House },
  { href: "#subscriptions", label: "購読", icon: Rss },
  { href: "#schedule", label: "生成時刻", icon: Clock3 },
  { href: "#library", label: "ライブラリ", icon: Library },
] as const

const statusCopy: Record<
  DashboardState,
  { label: string; title: string; description: string }
> = {
  ready: {
    label: "準備完了",
    title: "番組を生成できます",
    description: "現在の購読内容をスナップショットして生成を開始します。",
  },
  running: {
    label: "生成中",
    title: "番組を生成しています",
    description: "RSSの取得、要約、音声化を順番に進めています。",
  },
  succeeded: {
    label: "完了",
    title: "今日の番組が完成しました",
    description: "音声と参照した出典を確認できます。",
  },
}

function Brand() {
  return (
    <a
      className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      href="#today"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Headphones aria-hidden="true" className="size-4" />
      </span>
      News Podcast
    </a>
  )
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      aria-label={mobile ? "モバイルナビゲーション" : "メインナビゲーション"}
      className={cn(mobile ? "grid grid-cols-4 gap-1" : "flex flex-col gap-1")}
    >
      {navigationItems.map(({ href, icon: Icon, label }, index) => (
        <a
          aria-current={index === 0 ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center rounded-xl text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            mobile
              ? "flex-col justify-center gap-1 px-1 text-[0.6875rem]"
              : "gap-3 px-3",
            index === 0 && "bg-muted text-foreground"
          )}
          href={href}
          key={href}
        >
          <Icon aria-hidden="true" className="size-4" />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  )
}

function GenerationStatus({
  onGenerate,
  state,
}: Required<Pick<PodcastDashboardProps, "state">> &
  Pick<PodcastDashboardProps, "onGenerate">) {
  const copy = statusCopy[state]

  return (
    <section
      aria-labelledby="generation-heading"
      className="rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.label}
          </p>
          <h2 className="text-base font-semibold" id="generation-heading">
            {copy.title}
          </h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <Button
          className="min-h-11 px-4 sm:min-h-9"
          disabled={state === "running"}
          onClick={onGenerate}
        >
          <ListMusic aria-hidden="true" data-icon="inline-start" />
          {state === "running" ? "生成中" : "番組を生成"}
        </Button>
      </div>

      {state === "running" ? (
        <div className="mt-5 flex flex-col gap-2" role="status">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>音声を生成中</span>
            <span>2 / 4</span>
          </div>
          <div
            aria-label="番組生成の進捗"
            aria-valuemax={4}
            aria-valuemin={0}
            aria-valuenow={2}
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div className="h-full w-1/2 rounded-full bg-primary" />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function LatestEpisode({ state }: { state: DashboardState }) {
  return (
    <section aria-labelledby="library-heading" id="library">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            ライブラリ
          </p>
          <h2 className="text-lg font-semibold" id="library-heading">
            最新の番組
          </h2>
        </div>
        <a
          className="min-h-11 content-center rounded-lg px-2 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
          href="#library"
        >
          すべて見る
        </a>
      </div>

      {state === "succeeded" ? (
        <article className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">今日のテックニュース</h3>
            <p className="text-sm text-muted-foreground">
              音声 12分 ・ 出典 3件
            </p>
          </div>
          <audio
            aria-label="今日のテックニュースを再生"
            className="h-11 w-full"
            controls
            preload="none"
          />
          <details className="group rounded-xl bg-muted/60 px-4 py-3">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              出典を確認
            </summary>
            <ul className="flex flex-col gap-2 pb-1 text-sm text-muted-foreground">
              <li>Zenn</li>
              <li>azukiazusaの技術ブログ</li>
              <li>Hacker News</li>
            </ul>
          </details>
        </article>
      ) : (
        <div className="rounded-2xl border border-dashed p-6 text-center sm:p-8">
          <p className="text-sm font-medium">完成した番組はまだありません</p>
          <p className="mt-1 text-sm text-muted-foreground">
            生成が完了すると、音声と出典がここに表示されます。
          </p>
        </div>
      )}
    </section>
  )
}

function SettingsSummary() {
  return (
    <aside className="flex flex-col gap-4" aria-label="購読と生成設定">
      <section className="rounded-2xl border bg-card p-4" id="schedule">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              生成時刻
            </p>
            <h2 className="mt-1 font-semibold">毎日 07:30</h2>
            <p className="mt-1 text-sm text-muted-foreground">Asia/Tokyo</p>
          </div>
          <a
            className="min-h-11 content-center rounded-lg px-2 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
            href="#schedule"
          >
            変更
          </a>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4" id="subscriptions">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">購読</p>
            <h2 className="mt-1 font-semibold">3件のフィード</h2>
          </div>
          <a
            className="min-h-11 content-center rounded-lg px-2 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
            href="#subscriptions"
          >
            管理
          </a>
        </div>
        <ul className="flex flex-col divide-y text-sm">
          <li className="py-3 first:pt-0">Zenn</li>
          <li className="py-3">azukiazusaの技術ブログ</li>
          <li className="pt-3">Hacker News</li>
        </ul>
      </section>
    </aside>
  )
}

export function PodcastDashboard({
  onGenerate,
  state = "ready",
}: PodcastDashboardProps) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r bg-background p-4 md:flex md:flex-col md:gap-6">
        <Brand />
        <Navigation />
      </aside>

      <header className="sticky top-0 border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <Brand />
      </header>

      <main className="pb-24 md:ml-56 md:pb-0" id="today">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                今日の番組
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                購読中のRSSから、出典を確認できる音声番組を生成します。
              </p>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)] lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <GenerationStatus onGenerate={onGenerate} state={state} />
              <LatestEpisode state={state} />
            </div>
            <SettingsSummary />
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Navigation mobile />
      </div>
    </div>
  )
}
