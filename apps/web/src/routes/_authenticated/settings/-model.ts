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
 * 楽観的更新
 * ------------------------------------------------------------------ */

/**
 * 楽観適用は純粋なreducerとして切り出し、環境非依存にテストする
 * (`useSubscriptions`と同じ形)。
 *
 * 適用結果はあくまで一時的な投影で、確定値は常にサーバ応答。失敗時の巻き戻し
 * はTransitionの終了時にReactが行うので、ここでは「意図をそのまま当てる」
 * ことだけを書く。
 */

export type TagVocabulary<Tag, Suggestion> = {
  readonly tags: readonly Tag[]
  readonly suggestions: readonly Suggestion[]
}

export type TagVocabularyDraft<Tag> =
  /** `tag.id`は送信前に手元で振る仮の識別子。確定値はサーバ応答で置き換わる。 */
  | { readonly kind: "add"; readonly tag: Tag }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "promote"; readonly tag: Tag }

export function applyTagVocabularyDraft<
  Tag extends { readonly id: string; readonly name: string },
  Suggestion extends { readonly name: string },
>(
  state: TagVocabulary<Tag, Suggestion>,
  draft: TagVocabularyDraft<Tag>
): TagVocabulary<Tag, Suggestion> {
  if (draft.kind === "remove") {
    return {
      tags: state.tags.filter((tag) => tag.id !== draft.id),
      suggestions: state.suggestions,
    }
  }
  // 同名の作成はサーバ側で冪等。手元にある名前なら見た目も変えない。
  const known = state.tags.some((tag) => tag.name === draft.tag.name)
  return {
    tags: known ? state.tags : [...state.tags, draft.tag],
    // 採用した提案は、語彙へ移ったのだから提案側からは消える。
    suggestions:
      draft.kind === "promote"
        ? state.suggestions.filter(
            (suggestion) => suggestion.name !== draft.tag.name
          )
        : state.suggestions,
  }
}

export type ReadingDictionaryPatch = {
  readonly surface?: string
  readonly reading?: string
  readonly accentType?: number
}

export type ReadingDictionaryDraft<Entry> =
  | { readonly kind: "add"; readonly entry: Entry }
  | {
      readonly kind: "update"
      readonly id: string
      readonly patch: ReadingDictionaryPatch
    }
  | { readonly kind: "remove"; readonly id: string }

export function applyReadingDictionaryDraft<
  Entry extends { readonly id: string },
>(
  entries: readonly Entry[],
  draft: ReadingDictionaryDraft<Entry>
): readonly Entry[] {
  switch (draft.kind) {
    case "add":
      return [draft.entry, ...entries]
    case "update":
      return entries.map((entry) =>
        entry.id === draft.id ? { ...entry, ...draft.patch } : entry
      )
    case "remove":
      return entries.filter((entry) => entry.id !== draft.id)
  }
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
