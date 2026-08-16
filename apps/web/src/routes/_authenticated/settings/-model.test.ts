import { describe, expect, it } from "vitest"

import {
  normalizeReading,
  problemStatus,
  readingProblem,
  selectDictionaryEntries,
  validateSettingsSearch,
  willConvertReading,
} from "./-model"

describe("validateSettingsSearch", () => {
  it("keeps a known section", () => {
    expect(validateSettingsSearch({ section: "dictionary" })).toEqual({
      section: "dictionary",
    })
  })

  it("falls back for anything it does not know", () => {
    for (const value of [undefined, "", "tag", 3, null]) {
      expect(validateSettingsSearch({ section: value })).toEqual({
        section: "ai",
      })
    }
  })
})

/**
 * 読みの制約はContext間契約 (`packages/protocols`の`reading`) が持っている。
 * HTTPの入口は長さしか見ないので、ここが最後の防波堤になる。
 */
describe("読みの正規化と判定", () => {
  it("ひらがなをカタカナへ寄せる", () => {
    expect(normalizeReading("じーぴーてぃーふぁいぶ")).toBe(
      "ジーピーティーファイブ"
    )
  })

  it("半角カナと全角空白をNFKCで正規形へ寄せる", () => {
    expect(normalizeReading("ｼﾞｰﾋﾟｰﾃｨｰ")).toBe("ジーピーティー")
    expect(normalizeReading("　エス　キューライト　")).toBe("エス キューライト")
  })

  it("既にカタカナなら何も変えない", () => {
    expect(normalizeReading("ジーピーティー")).toBe("ジーピーティー")
    expect(willConvertReading("ジーピーティー")).toBe(false)
  })

  it("直せる入力は「変換して登録する」と分かる", () => {
    expect(willConvertReading("じーぴーてぃー")).toBe(true)
  })

  it("契約が受け付ける文字だけを通す", () => {
    expect(readingProblem("ジーピーティー")).toBeUndefined()
    expect(readingProblem("ヴィジョン・プロ")).toBeUndefined()
    expect(readingProblem("じーぴーてぃー")).toBeUndefined()
  })

  it("カタカナに直しようがない入力は理由付きで止める", () => {
    expect(readingProblem("GPT-5")).toBe("unsupported-characters")
    expect(readingProblem("読み方")).toBe("unsupported-characters")
    expect(readingProblem("   ")).toBe("empty")
    expect(readingProblem("ア".repeat(101))).toBe("too-long")
  })

  it("直せない入力は変換の予告も出さない", () => {
    expect(willConvertReading("GPT-5")).toBe(false)
  })
})

describe("selectDictionaryEntries", () => {
  const entries = [
    {
      surface: "GPT-5",
      reading: "ジーピーティーファイブ",
      source: "manual" as const,
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    {
      surface: "Durable Objects",
      reading: "デュラブルオブジェクツ",
      source: "ai_auto" as const,
      createdAt: "2026-08-10T00:00:00.000Z",
    },
    {
      surface: "SQLite",
      reading: "エスキューライト",
      source: "manual" as const,
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ]
  const all = { query: "", source: "all", sort: "recent" } as const

  it("既定は新しい順", () => {
    expect(selectDictionaryEntries(entries, all).map((e) => e.surface)).toEqual(
      ["Durable Objects", "SQLite", "GPT-5"]
    )
  })

  it("表記順は日本語の照合順で並べる", () => {
    expect(
      selectDictionaryEntries(entries, { ...all, sort: "surface" }).map(
        (e) => e.surface
      )
    ).toEqual(["Durable Objects", "GPT-5", "SQLite"])
  })

  it("由来で絞り込める", () => {
    expect(
      selectDictionaryEntries(entries, { ...all, source: "ai_auto" }).map(
        (e) => e.surface
      )
    ).toEqual(["Durable Objects"])
  })

  it("表記でも読みでも引ける", () => {
    expect(
      selectDictionaryEntries(entries, { ...all, query: "sqlite" }).map(
        (e) => e.surface
      )
    ).toEqual(["SQLite"])
    expect(
      selectDictionaryEntries(entries, { ...all, query: "エスキュー" }).map(
        (e) => e.surface
      )
    ).toEqual(["SQLite"])
  })

  it("絞り込みと由来は重ねて効く", () => {
    expect(
      selectDictionaryEntries(entries, {
        ...all,
        query: "エスキュー",
        source: "ai_auto",
      })
    ).toEqual([])
  })

  it("元の配列を破壊しない", () => {
    const original = [...entries]
    selectDictionaryEntries(entries, { ...all, sort: "surface" })
    expect(entries).toEqual(original)
  })
})

describe("problemStatus", () => {
  it("Problem DetailsからHTTP状態を取り出す", () => {
    expect(problemStatus({ status: 409, title: "conflict" })).toBe(409)
  })

  it("形の違うものはundefinedにする", () => {
    for (const value of [undefined, null, "409", new Error("boom"), {}]) {
      expect(problemStatus(value)).toBeUndefined()
    }
  })
})
