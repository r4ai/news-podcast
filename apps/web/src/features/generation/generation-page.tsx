import { Suspense, useEffect, useTransition } from "react"

import { api } from "@/api/client"
import { PanelSkeleton } from "@/app/app-shell"
import { queryClient } from "@/app/query-client"
import { stageLabel, statusLabel } from "./model"

const active = new Set(["queued", "running", "retrying"])

export function GenerationPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-primary">TODAY</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          今日のニュース番組
        </h1>
      </header>
      <Suspense fallback={<PanelSkeleton />}>
        <JobsPanel />
      </Suspense>
      <Suspense fallback={<PanelSkeleton />}>
        <LatestEpisode />
      </Suspense>
    </div>
  )
}

function JobsPanel() {
  const [isPending, startTransition] = useTransition()
  const jobs = api.useSuspenseQuery("get", "/v1/episode-jobs", undefined, {
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.items.some((job) => active.has(job.status)) ? 1_000 : false
    },
  })
  const createJob = api.useMutation("post", "/v1/episode-jobs")
  const latest = jobs.data.items[0]

  useEffect(() => {
    if (latest?.status === "succeeded") {
      void queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/episodes").queryKey,
      })
    }
  }, [latest?.status])

  function generate() {
    startTransition(async () => {
      await createJob.mutateAsync({
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: { trigger: "manual" },
      })
      await queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/episode-jobs").queryKey,
      })
    })
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">生成ステータス</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {latest
              ? `${statusLabel(latest.status)} · 試行 ${latest.attempt}`
              : "まだ生成していません"}
          </p>
          {latest?.stage && (
            <p className="mt-2 text-sm">{stageLabel(latest.stage)}</p>
          )}
          {latest?.nextAttemptAt && (
            <p className="text-sm text-amber-700">
              再試行:{" "}
              {new Date(latest.nextAttemptAt).toLocaleTimeString("ja-JP")}
            </p>
          )}
          {latest?.failure && (
            <p className="mt-2 text-sm text-destructive">
              {latest.failure.message}
            </p>
          )}
        </div>
        <button
          className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-50"
          disabled={isPending || Boolean(latest && active.has(latest.status))}
          onClick={generate}
          type="button"
        >
          {isPending ? "受付中…" : "番組を生成"}
        </button>
      </div>
    </section>
  )
}

function LatestEpisode() {
  const episodes = api.useSuspenseQuery("get", "/v1/episodes")
  const episode = episodes.data.items[0]
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">最新エピソード</h2>
      {episode ? (
        <div className="mt-3">
          <p className="font-medium">{episode.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(episode.createdAt).toLocaleString("ja-JP")} · 出典{" "}
            {episode.sources.length}件
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          完成した番組はまだありません。
        </p>
      )}
    </section>
  )
}
