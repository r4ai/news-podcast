import { useState, useTransition } from "react"

import { api } from "@/api/client"
import { queryClient } from "@/app/query-client"

export function SchedulePage() {
  const settings = api.useSuspenseQuery("get", "/v1/me/settings")
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.data.generationSchedule
  const [enabled, setEnabled] = useState(initial.enabled)
  const [localTime, setLocalTime] = useState(initial.localTime)
  const [timeZone, setTimeZone] = useState(initial.timeZone)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      await save.mutateAsync({
        body: { generationSchedule: { enabled, localTime, timeZone } },
      })
      await queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/me/settings").queryKey,
      })
    })
  }

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">生成時刻</h1>
        <p className="mt-2 text-muted-foreground">
          指定タイムゾーンで当日未生成なら、Worker再起動時にも一度catch-upします。
        </p>
      </header>
      <form
        className="space-y-5 rounded-2xl border bg-card p-6"
        onSubmit={submit}
      >
        <label className="flex items-center gap-3">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          毎日自動生成する
        </label>
        <label className="grid gap-2 text-sm">
          時刻
          <input
            className="rounded-lg border bg-background px-3 py-2"
            onChange={(event) => setLocalTime(event.target.value)}
            required
            type="time"
            value={localTime}
          />
        </label>
        <label className="grid gap-2 text-sm">
          IANA time zone
          <input
            className="rounded-lg border bg-background px-3 py-2"
            onChange={(event) => setTimeZone(event.target.value)}
            required
            value={timeZone}
          />
        </label>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "保存中…" : "設定を保存"}
        </button>
      </form>
    </div>
  )
}
