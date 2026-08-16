import { describe, expect, it } from "vitest"

import type {
  EpisodeJobAgUiEvent,
  EpisodeJobState,
} from "@news-podcast/contracts/agui"

import {
  emptyGenerationStream,
  failureRecovery,
  reduceGenerationStream,
  resolvedJobStatus,
  sameAdoptedArticles,
  sameJobFailure,
  selectionLabel,
  type GenerationStream,
} from "./model"

const snapshot: EpisodeJobState = {
  jobId: "job-1",
  status: "running",
  attempt: 1,
  maxAttempts: 4,
  selectionMode: "automatic",
  selectedArticles: [],
}

const reduceAll = (events: readonly EpisodeJobAgUiEvent[]): GenerationStream =>
  events.reduce(reduceGenerationStream, emptyGenerationStream)

describe("reduceGenerationStream", () => {
  it("builds a stage timeline from standard AG-UI events", () => {
    const result = reduceAll([
      { type: "STATE_SNAPSHOT", timestamp: 1, snapshot },
      {
        type: "RUN_STARTED",
        timestamp: 2,
        threadId: "job-1",
        runId: "job-1:attempt:1",
      },
      {
        type: "STEP_STARTED",
        timestamp: 3,
        stepName: "selecting_articles",
      },
      {
        type: "STEP_FINISHED",
        timestamp: 4,
        stepName: "selecting_articles",
      },
    ])

    expect(result.timeline).toEqual([
      {
        kind: "step",
        stepName: "selecting_articles",
        label: "記事を選定中",
        done: true,
      },
    ])
  })

  it("replaces selected articles from a state snapshot", () => {
    const result = reduceAll([
      {
        type: "STATE_SNAPSHOT",
        snapshot: {
          ...snapshot,
          selectedArticles: [
            { articleId: "a", title: "記事 a", sourceName: "Zenn" },
          ],
        },
      },
    ])
    expect(result.adoptedArticles).toEqual([
      { articleId: "a", title: "記事 a", sourceName: "Zenn" },
    ])
  })

  it("closes unfinished stages on retry errors and resumes the next run", () => {
    const errored = reduceAll([
      { type: "STATE_SNAPSHOT", snapshot },
      { type: "STEP_STARTED", stepName: "generating_script" },
      {
        type: "RUN_ERROR",
        message: "Episode generation will be retried",
        code: "script_unavailable",
      },
      {
        type: "STATE_SNAPSHOT",
        snapshot: {
          ...snapshot,
          status: "retrying",
          failure: {
            code: "script_unavailable",
            message: "Episode generation will be retried",
            retryable: true,
          },
        },
      },
    ])
    expect(errored.timeline.every((entry) => entry.done)).toBe(true)
    expect(errored.state?.status).toBe("retrying")

    const resumed = reduceGenerationStream(errored, {
      type: "RUN_STARTED",
      threadId: "job-1",
      runId: "job-1:attempt:2",
    })
    expect(resumed.state?.status).toBe("running")
  })

  it("finishes the run and any unfinished stage", () => {
    const result = reduceAll([
      { type: "STATE_SNAPSHOT", snapshot },
      { type: "STEP_STARTED", stepName: "storing_episode" },
      {
        type: "RUN_FINISHED",
        threadId: "job-1",
        runId: "job-1:attempt:1",
        outcome: { type: "success" },
      },
    ])
    expect(result.finished).toBe(true)
    expect(result.timeline.every((entry) => entry.done)).toBe(true)
  })
})

describe("view model helpers", () => {
  it.each([
    ["content_materialization_invalid", "reselect"],
    ["script_unavailable", "retry"],
    ["speech_malformed_response", "admin"],
    ["checkpoint_corruption", "admin"],
    ["invalid_script_sources", "new"],
  ] as const)("maps %s to %s", (code, expected) => {
    expect(failureRecovery(code)).toBe(expected)
  })

  it("prefers terminal streamed state and formats selection counts", () => {
    expect(resolvedJobStatus("succeeded", "running")).toBe("succeeded")
    expect(resolvedJobStatus(undefined, "running")).toBe("running")
    expect(selectionLabel(0)).toBe("記事を選択してください")
    expect(selectionLabel(3)).toBe("3/20件を選択中")
  })
})

/**
 * `STATE_SNAPSHOT`は進捗のたびに届き、そのたびに配列とオブジェクトを作り
 * 直す。参照で比べると中身が同じでも別物に見え、購読側が毎フレーム描き直
 * される。何をもって同じとするかをここで固定する。
 */
describe("sameAdoptedArticles", () => {
  const article = (id: string) => ({
    articleId: id,
    title: `記事 ${id}`,
    sourceName: "Zenn",
  })

  it("treats a rebuilt but identical list as unchanged", () => {
    expect(sameAdoptedArticles([article("a")], [article("a")])).toBe(true)
  })

  it("detects an added article", () => {
    expect(
      sameAdoptedArticles([article("a")], [article("a"), article("b")])
    ).toBe(false)
  })

  // 記事情報は後から埋まる (`sourceName`が「取得中」から名前へ変わる)。
  // それは画面に出る変化なので、同じとは見なさない。
  it("detects metadata that arrived later", () => {
    expect(
      sameAdoptedArticles(
        [{ articleId: "a", title: "記事 a", sourceName: undefined }],
        [article("a")]
      )
    ).toBe(false)
  })
})

describe("sameJobFailure", () => {
  const failure = {
    code: "provider-timeout",
    message: "timed out",
    retryable: true,
  }

  it("treats a rebuilt but identical failure as unchanged", () => {
    expect(sameJobFailure(failure, { ...failure })).toBe(true)
  })

  it("separates absence from presence", () => {
    expect(sameJobFailure(undefined, failure)).toBe(false)
    expect(sameJobFailure(undefined, undefined)).toBe(true)
  })

  it("detects a different failure code", () => {
    expect(
      sameJobFailure(failure, { ...failure, code: "job-deadline-exceeded" })
    ).toBe(false)
  })
})
