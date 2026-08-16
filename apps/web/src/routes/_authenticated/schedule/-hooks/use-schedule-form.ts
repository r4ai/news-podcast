import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { startTransition, useActionState, useState } from "react"
import { toast } from "@/shared/ui/toast"

import { settingsQueryOptions } from "@/features/settings"
import { api } from "@/shared/api"
import { useDebouncedCallback } from "@/shared/lib/use-debounced-callback"
import { recordBrowserEvent } from "@/shared/observability/events"
import {
  isSubmittable,
  supportedTimeZones,
  timeZoneOptions,
  toDraft,
  type ScheduleDraft,
} from "../-model"

/** 入力が落ち着いてから保存するまでの待ち時間。 */
const AUTOSAVE_DELAY_MS = 700

export type SaveState = "idle" | "saving" | "saved" | "error"

type SaveResult =
  | { readonly status: "idle" | "saved" }
  | { readonly status: "error"; readonly message: string }

const IDLE: SaveResult = { status: "idle" }

export function useScheduleForm() {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.generationSchedule
  const [draft, setDraft] = useState<ScheduleDraft>(() => toDraft(initial))
  const zones = supportedTimeZones(initial.timeZone)
  const timeZones = timeZoneOptions(zones)

  /**
   * 保存の実体。Reactのlifecycleに依存しないので、unmount後の駆け込み保存にも
   * そのまま使える。
   */
  async function persist(next: ScheduleDraft): Promise<SaveResult> {
    if (!isSubmittable(next)) {
      return {
        status: "error",
        message: "時刻とタイムゾーンを確認してください。",
      }
    }
    try {
      const updated = await save.mutateAsync({
        body: { generationSchedule: next },
      })
      queryClient.setQueryData(settingsQueryOptions.queryKey, updated)
      recordBrowserEvent("schedule.changed", { result: "succeeded" })
      return { status: "saved" }
    } catch {
      recordBrowserEvent("schedule.changed", { result: "failed" })
      toast.error("生成時刻を保存できませんでした")
      return {
        status: "error",
        message: "時刻とタイムゾーンを確認してください。",
      }
    }
  }

  /**
   * Actionはキューイングされ、最後の結果だけがstateになる。追い越された古い
   * 応答を自前でabortして捨てる必要がない。
   */
  const [result, submit, isSaving] = useActionState<SaveResult, ScheduleDraft>(
    (_previous, next) => persist(next),
    IDLE
  )

  /**
   * Actionをtransitionの外から呼ぶと、Reactはpendingを追跡できず`isSaving`が
   * 立たない。form経由以外の発火は必ずここを通す。
   */
  function startSave(next: ScheduleDraft) {
    startTransition(() => submit(next))
  }

  // 待機中の編集を抱えたまま画面を離れたら、保存してから閉じる。
  const submitLater = useDebouncedCallback(startSave, AUTOSAVE_DELAY_MS, {
    flushOnUnmount: true,
  })

  /** 時刻・タイムゾーンなど、入力が落ち着いてから保存したい操作。 */
  function update(patch: Partial<ScheduleDraft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    submitLater(next)
  }

  /** トグルやEnterキーなど、デバウンスを待たずに今すぐ確定させたい操作。 */
  function saveNow(patch: Partial<ScheduleDraft> = {}) {
    const next = { ...draft, ...patch }
    setDraft(next)
    submitLater.cancel()
    startSave(next)
  }

  const saveState: SaveState = isSaving ? "saving" : result.status

  return {
    draft,
    error: result.status === "error" ? result.message : undefined,
    saveState,
    timeZones,
    update,
    saveNow,
  } as const
}

export type ScheduleFormState = ReturnType<typeof useScheduleForm>
