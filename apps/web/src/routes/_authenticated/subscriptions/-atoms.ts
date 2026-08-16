import { atom } from "jotai"

/**
 * フィード追加フォームの下書き。
 *
 * hookのstateにすると、URLを1文字打つたびに購読フィード一覧まで描き直される。
 * 入力欄と送信ボタンだけが購読できるようatomへ置く。
 */
export const feedUrlDraftAtom = atom("")

export const canRegisterFeedAtom = atom(
  (get) => get(feedUrlDraftAtom).trim().length > 0
)

/** カタログから選んだフィード。 */
export const selectedCatalogFeedIdAtom = atom("")
