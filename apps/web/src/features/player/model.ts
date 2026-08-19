/**
 * 再生の規則。DOMにもReactにも触れない純粋な関数だけを置く。
 *
 * `<audio>`は「現在位置」と「総時間」しか教えてくれない。そこから先の
 * 「どこから再開するか」「聴き終わったと見なすか」は製品側の判断なので、
 * 要素の都合から切り離してここで決める。
 */

/** 聴き終わったと見なす末尾の余白。締め括りの数秒は飛ばしても支障がない。 */
export const FINISH_TAIL_SECONDS = 15

/** 巻き戻しと早送りの幅。聞き逃しは戻し、退屈は送りなので、幅を変える。 */
export const SKIP_BACK_SECONDS = 15
export const SKIP_FORWARD_SECONDS = 30

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2, 0.75] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

/** 端末に残す再生記録。1番組につき1件。 */
export type PlaybackEntry = {
  readonly position: number
  /** 総時間。`loadedmetadata`が届く前は0。 */
  readonly duration: number
  readonly updatedAt: number
}

export type ProgressMap = Readonly<Record<string, PlaybackEntry>>

export type ListeningState = "unplayed" | "in-progress" | "finished"

/**
 * バーが鳴らしている番組。台本や出典は持たない。
 * バーはリロードを跨いで残るので、ここへ載せるのは保存しても軽い分だけにする。
 */
export type PlayerTrack = {
  readonly episodeId: string
  readonly title: string
  readonly createdAt: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** 保存領域から読み戻した番組。形が合わなければ「載っていない」に倒す。 */
export function parsePlayerTrack(raw: unknown): PlayerTrack | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  if (
    !isNonEmptyString(candidate.episodeId) ||
    !isNonEmptyString(candidate.title) ||
    !isNonEmptyString(candidate.createdAt)
  ) {
    return undefined
  }
  return {
    episodeId: candidate.episodeId,
    title: candidate.title,
    createdAt: candidate.createdAt,
  }
}

const UNKNOWN_TIME = "--:--"

function isKnownTime(seconds: number | undefined): seconds is number {
  return seconds !== undefined && Number.isFinite(seconds)
}

/**
 * `1:05`／`1:02:03`。秒は切り捨てる。切り上げると、残り0の瞬間に総時間を
 * 1秒超えた表示になる。
 */
export function formatPlaybackTime(seconds: number | undefined): string {
  if (!isKnownTime(seconds)) return UNKNOWN_TIME
  const total = Math.floor(Math.max(0, seconds))
  const parts = [Math.floor(total / 60) % 60, total % 60]
  const hours = Math.floor(total / 3_600)
  if (hours > 0) parts.unshift(hours)
  return parts
    .map((part, index) =>
      index === 0 ? String(part) : String(part).padStart(2, "0")
    )
    .join(":")
}

/** 総時間が判るまでは上限を掛けない。掛けると0へ張り付いて操作が死ぬ。 */
export function clampTime(time: number, duration: number | undefined): number {
  const floored = Math.max(0, time)
  return isKnownTime(duration) && duration > 0
    ? Math.min(floored, duration)
    : floored
}

export function seekBy(
  position: number,
  offset: number,
  duration: number | undefined
): number {
  return clampTime(position + offset, duration)
}

export function progressRatio(
  position: number,
  duration: number | undefined
): number {
  if (!isKnownTime(duration) || duration <= 0) return 0
  return Math.min(1, Math.max(0, position / duration))
}

export function nextPlaybackRate(rate: number): PlaybackRate {
  const index = PLAYBACK_RATES.indexOf(rate as PlaybackRate)
  // 候補外の値は等倍へ戻す。保存値が古い候補のまま残っても操作が詰まらない。
  if (index < 0) return 1
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!
}

function isFinished(entry: PlaybackEntry): boolean {
  return (
    entry.duration > 0 && entry.position >= entry.duration - FINISH_TAIL_SECONDS
  )
}

export function listeningState(
  entry: PlaybackEntry | undefined
): ListeningState {
  if (entry === undefined || entry.position <= 0) return "unplayed"
  return isFinished(entry) ? "finished" : "in-progress"
}

/** 再開位置。聴き終わった番組は先頭へ戻す。末尾から再開しても何も鳴らない。 */
export function resumePosition(entry: PlaybackEntry | undefined): number {
  if (entry === undefined) return 0
  return isFinished(entry) ? 0 : Math.max(0, entry.position)
}

/** 一覧に添える聴取状態。未再生の番組には何も言わない。 */
export function listeningLabel(
  entry: PlaybackEntry | undefined
): string | undefined {
  const state = listeningState(entry)
  if (state === "unplayed") return undefined
  if (state === "finished") return "再生済み"
  // 総時間が判らない記録(metadataが届く前に離れた)では残りを言えない。
  return entry !== undefined && entry.duration > 0
    ? `残り ${formatPlaybackTime(entry.duration - entry.position)}`
    : "再生途中"
}

/** 端末に残す件数の上限。番組は増え続けるので、記録も無限には持たない。 */
const DEFAULT_PROGRESS_LIMIT = 200

export function recordProgress(
  map: ProgressMap,
  episodeId: string,
  entry: PlaybackEntry,
  limit: number = DEFAULT_PROGRESS_LIMIT
): ProgressMap {
  const merged = { ...map, [episodeId]: entry }
  const ids = Object.keys(merged)
  if (ids.length <= limit) return merged
  const surviving = ids
    .toSorted(
      (left, right) => merged[right]!.updatedAt - merged[left]!.updatedAt
    )
    .slice(0, limit)
  return Object.fromEntries(surviving.map((id) => [id, merged[id]!]))
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isPlaybackEntry(value: unknown): value is PlaybackEntry {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isNonNegativeNumber(candidate.position) &&
    isNonNegativeNumber(candidate.duration) &&
    isNonNegativeNumber(candidate.updatedAt)
  )
}

/**
 * 保存領域の中身は別のタブや過去の版が書いたもので、形は保証されない。
 * 壊れた項目だけを落とし、読める記録は残す。全部捨てると、1件の破損で
 * 全番組の続きが消える。
 */
export function parseProgressMap(raw: unknown): ProgressMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (pair): pair is [string, PlaybackEntry] => isPlaybackEntry(pair[1])
    )
  )
}
