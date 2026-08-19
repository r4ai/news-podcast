import { describe, expect, it } from "vitest"

import {
  defaultLibrarySearch,
  episodeMetaLabel,
  groupEpisodesByDate,
  scriptLength,
  scriptParagraphs,
  siblingEpisodeId,
  sourceKindLabel,
  validateLibrarySearch,
  type Episode,
} from "./-model"

const now = new Date("2026-08-19T09:00:00.000Z")

const episode = (patch: Partial<Episode> = {}): Episode => ({
  id: "episode-1",
  title: "今日のニュース",
  script: "本文",
  sources: [{ url: "https://example.com/a", title: "記事A" }],
  createdAt: now.toISOString(),
  ...patch,
})

describe("validateLibrarySearch", () => {
  it("選択中の番組はURLが正本。空文字は未選択に倒す", () => {
    expect(validateLibrarySearch({ episode: "abc" })).toEqual({
      episode: "abc",
    })
    expect(validateLibrarySearch({ episode: "" })).toEqual(defaultLibrarySearch)
    expect(validateLibrarySearch({ episode: 42 })).toEqual(defaultLibrarySearch)
    expect(validateLibrarySearch({})).toEqual(defaultLibrarySearch)
  })
})

describe("groupEpisodesByDate", () => {
  it("生成日で括り、連続する同じ括りはまとめる", () => {
    const groups = groupEpisodesByDate(
      [
        episode({ id: "a" }),
        episode({ id: "b" }),
        episode({ id: "c", createdAt: "2026-07-01T00:00:00.000Z" }),
      ],
      now
    )
    expect(groups.map((group) => group.key)).toEqual(["today", "older"])
    expect(groups[0]?.episodes).toHaveLength(2)
  })
})

describe("scriptParagraphs", () => {
  it("空行でも改行1つでも段落に割る", () => {
    expect(scriptParagraphs("一段落目\n\n二段落目\n三段落目")).toEqual([
      "一段落目",
      "二段落目",
      "三段落目",
    ])
  })

  it("前後の空白だけの行は落とす", () => {
    expect(scriptParagraphs("  \n本文  \n \n")).toEqual(["本文"])
  })

  it("改行の無い台本は1段落として扱う", () => {
    expect(scriptParagraphs("ひと続きの台本")).toEqual(["ひと続きの台本"])
  })
})

describe("scriptLength", () => {
  it("改行と空白を除いた字数を数える。読む量の目安にする", () => {
    expect(scriptLength("あいう\nえお ")).toBe(5)
  })

  it("絵文字のような複数コード単位の文字も1字として数える", () => {
    expect(scriptLength("あ🎧")).toBe(2)
  })
})

describe("episodeMetaLabel", () => {
  it("生成時刻・出典件数・台本の長さを1行にまとめる", () => {
    expect(
      episodeMetaLabel(
        episode({
          script: "あいうえお",
          sources: [
            { url: "https://example.com/a", title: "A" },
            { url: "https://example.com/b", title: "B" },
          ],
        })
      )
    ).toContain("出典2件")
  })
})

describe("sourceKindLabel", () => {
  it.for([
    ["rss", "RSS"],
    ["web", "Web"],
    [null, undefined],
    [undefined, undefined],
  ] as const)("%s は %s と示す", ([kind, expected]) => {
    expect(sourceKindLabel(kind)).toBe(expected)
  })
})

describe("siblingEpisodeId", () => {
  const episodes = [
    episode({ id: "a" }),
    episode({ id: "b" }),
    episode({ id: "c" }),
  ]

  it("未選択なら端から始める", () => {
    expect(siblingEpisodeId(episodes, undefined, 1)).toBe("a")
    expect(siblingEpisodeId(episodes, undefined, -1)).toBe("c")
  })

  it("前後へ送る", () => {
    expect(siblingEpisodeId(episodes, "b", 1)).toBe("c")
    expect(siblingEpisodeId(episodes, "b", -1)).toBe("a")
  })

  it("端では動かさない。行き止まりで選択が消えると操作が途切れる", () => {
    expect(siblingEpisodeId(episodes, "c", 1)).toBe("c")
    expect(siblingEpisodeId(episodes, "a", -1)).toBe("a")
  })

  it("一覧に無いIDは端から数え直す", () => {
    expect(siblingEpisodeId(episodes, "zzz", 1)).toBe("a")
  })

  it("空の一覧では選べない", () => {
    expect(siblingEpisodeId([], undefined, 1)).toBeUndefined()
  })
})
