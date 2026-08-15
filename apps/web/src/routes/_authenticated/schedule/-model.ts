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

/**
 * `Asia/Tokyo` → `Asia/Tokyo (UTC+9)` のように、現在時点のUTCオフセットを
 * 付けたラベルを作る。不正なzone名は元の名前のまま返す。
 */
export function timeZoneLabel(zone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now)
    const offset = parts.find((part) => part.type === "timeZoneName")?.value
    return offset ? `${zone} (${offset.replace("GMT", "UTC")})` : zone
  } catch {
    return zone
  }
}

export type TimeZoneOption = {
  readonly value: string
  readonly label: string
}

/**
 * zone一覧をコンボボックス用の value/label に変換する。
 * `now` は呼び出し1回につき1つのDateを共有し、候補ごとにフォーマッタを
 * 再構築しないようにするための引数。
 */
export function timeZoneOptions(
  zones: readonly string[],
  now: Date = new Date()
): readonly TimeZoneOption[] {
  return zones.map((zone) => ({ value: zone, label: timeZoneLabel(zone, now) }))
}
