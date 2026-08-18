import { describe, expect, it } from "vitest"

import {
  FINISH_TAIL_SECONDS,
  PLAYBACK_RATES,
  clampTime,
  formatPlaybackTime,
  listeningLabel,
  listeningState,
  nextPlaybackRate,
  parsePlayerTrack,
  parseProgressMap,
  progressRatio,
  recordProgress,
  resumePosition,
  seekBy,
  type PlaybackEntry,
} from "./model"

const entry = (patch: Partial<PlaybackEntry> = {}): PlaybackEntry => ({
  position: 30,
  duration: 600,
  updatedAt: 1_000,
  ...patch,
})

describe("formatPlaybackTime", () => {
  it.for([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [600, "10:00"],
    [3_723, "1:02:03"],
    // 端数は切り捨てる。0.9秒を1秒と読ませると、総時間より先に進んで見える。
    [59.9, "0:59"],
  ] as const)("%s秒を%sと書く", ([seconds, expected]) => {
    expect(formatPlaybackTime(seconds)).toBe(expected)
  })

  it.for([undefined, Number.NaN, Number.POSITIVE_INFINITY] as const)(
    "総時間が判っていない間(%s)は伏せる",
    (seconds) => {
      expect(formatPlaybackTime(seconds)).toBe("--:--")
    }
  )

  it("負の位置は先頭として扱う", () => {
    expect(formatPlaybackTime(-3)).toBe("0:00")
  })
})

describe("clampTime", () => {
  it("総時間が判っていれば0..総時間へ収める", () => {
    expect(clampTime(-5, 600)).toBe(0)
    expect(clampTime(700, 600)).toBe(600)
    expect(clampTime(120, 600)).toBe(120)
  })

  it("総時間が判らない間も、先頭より前へは戻さない", () => {
    expect(clampTime(-5, undefined)).toBe(0)
    expect(clampTime(700, undefined)).toBe(700)
  })
})

describe("seekBy", () => {
  it("送りと戻しは総時間の内側で止まる", () => {
    expect(seekBy(100, 30, 600)).toBe(130)
    expect(seekBy(10, -15, 600)).toBe(0)
    expect(seekBy(590, 30, 600)).toBe(600)
  })
})

describe("progressRatio", () => {
  it.for([
    [0, 600, 0],
    [300, 600, 0.5],
    [900, 600, 1],
    [30, 0, 0],
    [30, undefined, 0],
  ] as const)("位置%s/総時間%sは%s", ([position, duration, expected]) => {
    expect(progressRatio(position, duration)).toBe(expected)
  })
})

describe("nextPlaybackRate", () => {
  it("候補を順に巡り、最後は先頭へ戻る", () => {
    const visited = PLAYBACK_RATES.map((_, index) =>
      PLAYBACK_RATES.slice(0, index + 1).reduce(
        (rate) => nextPlaybackRate(rate),
        PLAYBACK_RATES[0]!
      )
    )
    expect(visited.at(-1)).toBe(PLAYBACK_RATES[0])
  })

  it("候補に無い速度は等倍へ戻す", () => {
    expect(nextPlaybackRate(3.3)).toBe(1)
  })
})

describe("listeningState", () => {
  it("記録が無ければ未再生", () => {
    expect(listeningState(undefined)).toBe("unplayed")
  })

  it("先頭のままの記録も未再生として扱う", () => {
    expect(listeningState(entry({ position: 0 }))).toBe("unplayed")
  })

  it("途中まで聴いていれば再生途中", () => {
    expect(listeningState(entry({ position: 120 }))).toBe("in-progress")
  })

  it("末尾の余白まで達していれば再生済み", () => {
    expect(listeningState(entry({ position: 600 - FINISH_TAIL_SECONDS }))).toBe(
      "finished"
    )
  })

  it("総時間が判らない記録は再生途中に留める", () => {
    expect(listeningState(entry({ duration: 0, position: 90 }))).toBe(
      "in-progress"
    )
  })
})

describe("resumePosition", () => {
  it("記録が無ければ先頭から", () => {
    expect(resumePosition(undefined)).toBe(0)
  })

  it("途中で止めた位置から再開する", () => {
    expect(resumePosition(entry({ position: 120 }))).toBe(120)
  })

  it("聴き終わった番組は先頭から。末尾で固まって動かないのを避ける", () => {
    expect(resumePosition(entry({ position: 600 }))).toBe(0)
  })
})

describe("listeningLabel", () => {
  it.for([
    [undefined, undefined],
    [entry({ position: 0 }), undefined],
    [entry({ position: 120 }), "残り 8:00"],
    [entry({ position: 600 }), "再生済み"],
    [entry({ duration: 0, position: 90 }), "再生途中"],
  ] as const)("%o は %s と示す", ([value, expected]) => {
    expect(listeningLabel(value)).toBe(expected)
  })
})

describe("recordProgress", () => {
  it("記録は番組ごとに上書きされる", () => {
    const first = recordProgress({}, "a", entry({ position: 10 }))
    const second = recordProgress(first, "a", entry({ position: 20 }))
    expect(second).toEqual({ a: entry({ position: 20 }) })
  })

  it("入力を書き換えない", () => {
    const before = { a: entry() }
    recordProgress(before, "b", entry({ position: 5 }))
    expect(before).toEqual({ a: entry() })
  })

  it("上限を超えたら古い記録から捨てる。端末の保存領域は無限ではない", () => {
    const filled = Object.fromEntries(
      Array.from({ length: 3 }, (_, index) => [
        `episode-${index}`,
        entry({ updatedAt: index }),
      ])
    )
    const pruned = recordProgress(filled, "newest", entry({ updatedAt: 99 }), 3)
    expect(Object.keys(pruned).toSorted()).toEqual([
      "episode-1",
      "episode-2",
      "newest",
    ])
  })
})

describe("parseProgressMap", () => {
  it("保存された記録を読み戻す", () => {
    expect(parseProgressMap({ a: entry() })).toEqual({ a: entry() })
  })

  it.for([null, undefined, 42, "x", []] as const)(
    "記録として読めない値(%s)は空として扱う",
    (raw) => {
      expect(parseProgressMap(raw)).toEqual({})
    }
  )

  it("壊れた項目だけを落とし、読める項目は残す", () => {
    const raw = {
      good: entry(),
      missing: { position: 1 },
      wrongType: { position: "1", duration: 2, updatedAt: 3 },
      negative: { position: -1, duration: 2, updatedAt: 3 },
    }
    expect(parseProgressMap(raw)).toEqual({ good: entry() })
  })
})

describe("parsePlayerTrack", () => {
  it("保存された番組を読み戻す", () => {
    const track = {
      episodeId: "id",
      title: "題",
      createdAt: "2026-08-19T00:00:00.000Z",
    }
    expect(parsePlayerTrack({ ...track, extra: 1 })).toEqual(track)
  })

  it.for([
    null,
    "id",
    { episodeId: "id" },
    { episodeId: "", title: "題", createdAt: "x" },
    { episodeId: "id", title: 1, createdAt: "x" },
  ] as const)("形が合わない値(%o)は載っていない扱いにする", (raw) => {
    expect(parsePlayerTrack(raw)).toBeUndefined()
  })
})
