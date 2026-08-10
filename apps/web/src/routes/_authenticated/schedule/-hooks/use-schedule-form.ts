import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useMemo, useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { settingsQueryOptions } from "@/features/settings"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"
import {
  isSubmittable,
  supportedTimeZones,
  toDraft,
  type ScheduleDraft,
} from "../-model"

export function useScheduleForm() {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.generationSchedule
  const [draft, setDraft] = useState<ScheduleDraft>(() => toDraft(initial))
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const timeZones = useMemo(
    () => supportedTimeZones(initial.timeZone),
    [initial.timeZone]
  )

  function update(patch: Partial<ScheduleDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function submit() {
    setError(undefined)
    startTransition(async () => {
      try {
        const updated = await save.mutateAsync({
          body: { generationSchedule: draft },
        })
        queryClient.setQueryData(settingsQueryOptions.queryKey, updated)
        recordBrowserEvent("schedule.changed", { result: "succeeded" })
        toast.success("生成時刻を保存しました")
      } catch {
        recordBrowserEvent("schedule.changed", { result: "failed" })
        setError("時刻とタイムゾーンを確認してください。")
        toast.error("生成時刻を保存できませんでした")
      }
    })
  }

  return {
    draft,
    error,
    pending,
    timeZones,
    canSubmit: isSubmittable(draft) && !pending,
    update,
    submit,
  } as const
}

export type ScheduleFormState = ReturnType<typeof useScheduleForm>
