import type { InterestProfile } from "@/features/settings"

export type InterestProfileDraft = {
  readonly include: string
  readonly exclude: string
}

export function toDraft(profile: InterestProfile): InterestProfileDraft {
  return { include: profile.include, exclude: profile.exclude }
}

// サーバ側の上限(schemas.ts InterestProfileSchema)と揃える。
export const INTEREST_PROFILE_MAX_LENGTH = 2_000

export function isWithinLimit(draft: InterestProfileDraft): boolean {
  return (
    draft.include.length <= INTEREST_PROFILE_MAX_LENGTH &&
    draft.exclude.length <= INTEREST_PROFILE_MAX_LENGTH
  )
}

/** 保存する意味があるのは、保存済みの内容と違うときだけ。 */
export function isDirty(
  draft: InterestProfileDraft,
  saved: InterestProfileDraft
): boolean {
  return draft.include !== saved.include || draft.exclude !== saved.exclude
}

/* ------------------------------------------------------------------ *
 * 設定の項目
 * ------------------------------------------------------------------ */

export const settingsSections = ["ai", "tags", "dictionary"] as const

export type SettingsSection = (typeof settingsSections)[number]

export type SettingsSearch = {
  readonly section: SettingsSection
}

export const defaultSettingsSection: SettingsSection = "ai"

/**
 * 開いている項目はURLが持つ。戻る/進むで行き来でき、
 * 「読み辞書のここを見て」とリンクを渡せる。
 */
export function validateSettingsSearch(
  search: Record<string, unknown>
): SettingsSearch {
  const section = search.section
  return {
    section: settingsSections.includes(section as SettingsSection)
      ? (section as SettingsSection)
      : defaultSettingsSection,
  }
}

/* ------------------------------------------------------------------ *
 * 読み辞書
 * ------------------------------------------------------------------ */

/**
 * 読みとして受け付けられる文字。
 *
 * これは見た目の好みではなく、Context間契約
 * (`packages/protocols/src/personalization-rpc.ts`の`reading`) が課している制約。
 * HTTPの入口は長さしか見ないので、ひらがなのまま送ると受理された後に
 * RPC境界で落ち、画面には「辞書に追加できませんでした」としか出ない。
 * 送る前にここで同じ規則を当て、直せるものは直し、直せないものは理由を出す。
 */
const READING_PATTERN = /^[ァ-ヶー・ ]+$/u

const HIRAGANA_START = 0x3041
const HIRAGANA_END = 0x3096
const HIRAGANA_TO_KATAKANA = 0x60

/**
 * ひらがなをカタカナへ、半角カナと全角空白をNFKCで正規形へ寄せる。
 * 「じーぴーてぃー」も「ｼﾞｰﾋﾟｰﾃｨｰ」も、利用者にとっては同じ入力のつもり。
 */
export function normalizeReading(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/gu, (character) => {
      const code = character.codePointAt(0)
      return code !== undefined &&
        code >= HIRAGANA_START &&
        code <= HIRAGANA_END
        ? String.fromCodePoint(code + HIRAGANA_TO_KATAKANA)
        : character
    })
    .trim()
}

export type ReadingProblem = "empty" | "unsupported-characters" | "too-long"

export const READING_MAX_LENGTH = 100

export function readingProblem(value: string): ReadingProblem | undefined {
  const normalized = normalizeReading(value)
  if (normalized.length === 0) return "empty"
  if (normalized.length > READING_MAX_LENGTH) return "too-long"
  return READING_PATTERN.test(normalized) ? undefined : "unsupported-characters"
}

export const readingProblemMessages: Record<ReadingProblem, string> = {
  empty: "読みを入力してください。",
  "too-long": `読みは${READING_MAX_LENGTH}文字までです。`,
  "unsupported-characters":
    "読みは全角カタカナで入力してください（例: ジーピーティーファイブ）。",
}

/** 打った内容と、実際に登録される内容が違うときだけ知らせる。 */
export function willConvertReading(value: string): boolean {
  const normalized = normalizeReading(value)
  return normalized !== value.trim() && readingProblem(value) === undefined
}

export const dictionarySources = ["all", "manual", "ai_auto"] as const
export type DictionarySource = (typeof dictionarySources)[number]

export const dictionarySorts = ["recent", "surface"] as const
export type DictionarySort = (typeof dictionarySorts)[number]

type DictionaryEntry = {
  readonly surface: string
  readonly reading: string
  readonly source: "manual" | "ai_auto"
  readonly createdAt: string
}

/**
 * 絞り込みと並べ替えは純粋な関数として置く。画面はここを呼ぶだけにし、
 * 「どの条件でどう並ぶか」はテストから直接確かめられるようにする。
 */
export function selectDictionaryEntries<T extends DictionaryEntry>(
  entries: readonly T[],
  options: {
    readonly query: string
    readonly source: DictionarySource
    readonly sort: DictionarySort
  }
): readonly T[] {
  const query = options.query.trim().toLowerCase()
  const filtered = entries.filter((entry) => {
    if (options.source !== "all" && entry.source !== options.source) {
      return false
    }
    if (query === "") return true
    return (
      entry.surface.toLowerCase().includes(query) ||
      entry.reading.toLowerCase().includes(query)
    )
  })
  return options.sort === "surface"
    ? [...filtered].sort((left, right) =>
        left.surface.localeCompare(right.surface, "ja")
      )
    : [...filtered].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      )
}

/* ------------------------------------------------------------------ *
 * エラー応答
 * ------------------------------------------------------------------ */

/**
 * Problem DetailsのHTTP状態を取り出す。openapi-fetchは応答bodyをそのまま
 * throwするので、`catch`で受けた値がそれになる。
 */
export function problemStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}
