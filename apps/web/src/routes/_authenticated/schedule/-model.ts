import type { GenerationSchedule } from "@/features/settings"

/**
 * `Asia/Tokyo` と `UTC` を先頭候補として保証しつつ、
 * 現在の設定値がruntimeの一覧に無くても選択肢から消えないようにする。
 */
export function supportedTimeZones(current: string): readonly string[] {
  const supported = Intl.supportedValuesOf?.("timeZone") ?? []
  return Array.from(
    new Set([current, "Asia/Tokyo", "UTC", ...supported])
  ).sort()
}

export type ScheduleDraft = {
  readonly enabled: boolean
  readonly localTime: string
  readonly timeZone: string
}

export function toDraft(schedule: GenerationSchedule): ScheduleDraft {
  return {
    enabled: schedule.enabled,
    localTime: schedule.localTime,
    timeZone: schedule.timeZone,
  }
}

export function isSubmittable(draft: ScheduleDraft): boolean {
  return draft.timeZone.length > 0 && draft.localTime.length > 0
}
