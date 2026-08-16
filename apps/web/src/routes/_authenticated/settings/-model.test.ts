import { describe, expect, it } from "vitest"

import {
  applyReadingDictionaryDraft,
  applyTagVocabularyDraft,
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

describe("applyTagVocabularyDraft", () => {
  const tag = (id: string, name: string) => ({
    id,
    name,
    createdAt: "2026-08-12T00:00:00.000Z",
  })
  const suggestion = (name: string) => ({
    name,
    occurrences: 3,
    lastSeenAt: "2026-08-12T00:00:00.000Z",
  })
  const state = {
    tags: [tag("tag-0", "AI"), tag("tag-1", "Rust")],
    suggestions: [suggestion("WASM")],
  }

  it("removes only the targeted tag", () => {
    const next = applyTagVocabularyDraft(state, { kind: "remove", id: "tag-0" })
    expect(next.tags.map((item) => item.name)).toEqual(["Rust"])
    expect(next.suggestions).toBe(state.suggestions)
  })

  it("appends a provisional tag while the request is in flight", () => {
    const next = applyTagVocabularyDraft(state, {
      kind: "add",
      tag: tag("draft-1", "TypeScript"),
    })
    expect(next.tags.map((item) => item.name)).toEqual([
      "AI",
      "Rust",
      "TypeScript",
    ])
  })

  // 同名の作成はサーバ側で冪等。件数が増えたように見せると、応答が返った
  // 瞬間に1件減って見える。
  it("leaves the vocabulary untouched when the name is already known", () => {
    const next = applyTagVocabularyDraft(state, {
      kind: "add",
      tag: tag("draft-1", "AI"),
    })
    expect(next.tags).toBe(state.tags)
  })

  // 採用は「提案から語彙へ移す」操作。片側だけ動くと、採用した名前が
  // 両方に出たままになる。
  it("moves a promoted suggestion into the vocabulary", () => {
    const next = applyTagVocabularyDraft(state, {
      kind: "promote",
      tag: tag("draft-1", "WASM"),
    })
    expect(next.tags.map((item) => item.name)).toContain("WASM")
    expect(next.suggestions).toEqual([])
  })
})

describe("applyReadingDictionaryDraft", () => {
  const entry = {
    id: "entry-0",
    surface: "GPT-5",
    reading: "ジーピーティーファイブ",
    accentType: 0,
    source: "manual" as const,
    createdAt: "2026-08-12T00:00:00.000Z",
  }

  it("removes only the targeted entry", () => {
    expect(
      applyReadingDictionaryDraft([entry], { kind: "remove", id: "entry-0" })
    ).toEqual([])
  })

  // 新しい登録は「新しい順」の先頭に来る。末尾へ足すと、既定の並びでは
  // 画面の外に現れて、追加できたのかどうか分からない。
  it("puts a new entry at the head", () => {
    const added = {
      ...entry,
      id: "draft-1",
      surface: "Rust",
      reading: "ラスト",
    }
    expect(
      applyReadingDictionaryDraft([entry], { kind: "add", entry: added }).map(
        (item) => item.id
      )
    ).toEqual(["draft-1", "entry-0"])
  })

  it("applies a patch to the matching entry only", () => {
    const next = applyReadingDictionaryDraft([entry], {
      kind: "update",
      id: "entry-0",
      patch: { reading: "ジーピーティーゴ" },
    })
    expect(next[0]?.reading).toBe("ジーピーティーゴ")
    expect(next[0]?.surface).toBe("GPT-5")
  })
})
