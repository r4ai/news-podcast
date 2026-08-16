import { atom } from "jotai"
import { atomFamily } from "jotai/utils"

import { readingProblem, willConvertReading } from "./-model"

/**
 * 設定画面の下書き。
 *
 * 送信されるまでサーバには存在しない値なので、server stateとは別に持つ。
 * hookのstateにすると打鍵のたびにパネル全体 (登録済みの一覧を含む) が
 * 描き直されるため、入力欄だけが購読できるatomに置く。
 */

/** 読み辞書の新規追加フォーム。 */
export const readingSurfaceDraftAtom = atom("")
export const readingReadingDraftAtom = atom("")

/**
 * 読みとして受け付けられない文字が入っているか。
 *
 * 派生atomにしておくと、購読側が見るのは「問題の種類」だけになる。
 * 正しいカタカナを打ち続けている間は値が`undefined`のままなので、
 * 打鍵のたびに注意書きが描き直されることもない。
 */
export const readingProblemAtom = atom((get) => {
  const reading = get(readingReadingDraftAtom)
  return reading.trim() === "" ? undefined : readingProblem(reading)
})

/** 打った内容と、実際に登録される内容が違うか（ひらがな→カタカナなど）。 */
export const readingWillConvertAtom = atom((get) =>
  willConvertReading(get(readingReadingDraftAtom))
)

/** 「追加」を押せるか。派生atomなので、判定の置き場は1つで済む。 */
export const canAddReadingAtom = atom(
  (get) =>
    get(readingSurfaceDraftAtom).trim().length > 0 &&
    get(readingReadingDraftAtom).trim().length > 0 &&
    get(readingProblemAtom) === undefined
)

/**
 * 既存項目の編集。行ごとに独立した下書きなので`atomFamily`で持つ。
 * 1行を編集しても、他の行は購読していないので描き直されない。
 */
export const readingEntryEditAtom = atomFamily((_id: string) =>
  atom<{ readonly surface: string; readonly reading: string } | null>(null)
)
// idはentryの寿命に従うので、家族の要素はentryが消えたときに捨てる。
export const forgetReadingEntryEdit = (id: string) =>
  readingEntryEditAtom.remove(id)

/** タグ語彙の新規追加フォーム。 */
export const tagNameDraftAtom = atom("")
export const canAddTagAtom = atom(
  (get) => get(tagNameDraftAtom).trim().length > 0
)
