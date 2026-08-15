import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { settingsQueryOptions } from "@/features/settings"
import { api } from "@/shared/api"
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
/** 保存済み表示を静かに消すまでの時間。 */
const SAVED_INDICATOR_MS = 2000

export type SaveState = "idle" | "saving" | "saved" | "error"

type PendingAutosave = {
  readonly timer: ReturnType<typeof setTimeout>
  readonly next: ScheduleDraft
}

export function useScheduleForm() {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.generationSchedule
  const [draft, setDraft] = useState<ScheduleDraft>(() => toDraft(initial))
  const [error, setError] = useState<string>()
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const zones = useMemo(
    () => supportedTimeZones(initial.timeZone),
    [initial.timeZone]
  )
  const timeZones = useMemo(() => timeZoneOptions(zones), [zones])

  const savedIndicatorRef = useRef<ReturnType<typeof setTimeout>>()
  const pendingAutosaveRef = useRef<PendingAutosave>()
  // 発行中の保存。新しい保存を始めるときに前回分をabortすることで、
  // 追い越された古い応答が後から届いても結果を上書きしないようにする。
  const abortRef = useRef<AbortController>()

  function persist(next: ScheduleDraft) {
    if (!isSubmittable(next)) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setError(undefined)
    setSaveState("saving")
    save
      .mutateAsync({
        body: { generationSchedule: next },
        signal: controller.signal,
      })
      .then((updated) => {
        if (controller.signal.aborted) return // 追い越されたので結果は捨てる
        queryClient.setQueryData(settingsQueryOptions.queryKey, updated)
        recordBrowserEvent("schedule.changed", { result: "succeeded" })
        setSaveState("saved")
        clearTimeout(savedIndicatorRef.current)
        savedIndicatorRef.current = setTimeout(
          () => setSaveState("idle"),
          SAVED_INDICATOR_MS
        )
      })
      .catch(() => {
        if (controller.signal.aborted) return
        recordBrowserEvent("schedule.changed", { result: "failed" })
        toast.error("生成時刻を保存できませんでした")
        setError("時刻とタイムゾーンを確認してください。")
        setSaveState("error")
      })
  }

  function flushPendingAutosave() {
    const pending = pendingAutosaveRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingAutosaveRef.current = undefined
    persist(pending.next)
  }

  useEffect(() => {
    // unmount時、まだデバウンス待ちの編集が残っていれば即座に保存する。
    return () => {
      clearTimeout(savedIndicatorRef.current)
      flushPendingAutosave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 時刻・タイムゾーンなど、入力が落ち着いてから保存したい操作。 */
  function update(patch: Partial<ScheduleDraft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    clearTimeout(pendingAutosaveRef.current?.timer)
    pendingAutosaveRef.current = {
      next,
      timer: setTimeout(() => {
        pendingAutosaveRef.current = undefined
        persist(next)
      }, AUTOSAVE_DELAY_MS),
    }
  }

  /** トグルやEnterキーなど、デバウンスを待たずに今すぐ確定させたい操作。 */
  function saveNow(patch: Partial<ScheduleDraft> = {}) {
    const next = { ...draft, ...patch }
    setDraft(next)
    clearTimeout(pendingAutosaveRef.current?.timer)
    pendingAutosaveRef.current = undefined
    persist(next)
  }

  return {
    draft,
    error,
    saveState,
    timeZones,
    update,
    saveNow,
  } as const
}

export type ScheduleFormState = ReturnType<typeof useScheduleForm>
