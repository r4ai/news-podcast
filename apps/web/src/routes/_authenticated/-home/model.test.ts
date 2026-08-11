import { describe, expect, it } from "vitest"

import type { AgUiEvent, EpisodeJobState } from "@news-podcast/contracts/agui"

import {
  emptyGenerationStream,
  reduceGenerationStream,
  selectionLabel,
  toolLabel,
  type GenerationStream,
} from "./model"

const snapshot: EpisodeJobState = {
  jobId: "job-1",
  status: "running",
  attempt: 1,
  maxAttempts: 4,
  adoptedArticles: [],
}

function reduceAll(events: readonly AgUiEvent[]): GenerationStream {
  return events.reduce(reduceGenerationStream, emptyGenerationStream)
}

const at = (timestamp = 1) => ({ timestamp })

describe("reduceGenerationStream", () => {
  it("builds the timeline from a full run", () => {
    const result = reduceAll([
      { ...at(), type: "STATE_SNAPSHOT", snapshot },
      { ...at(), type: "RUN_STARTED", threadId: "job-1", runId: "job-1" },
      { ...at(), type: "STEP_STARTED", stepName: "researching_sources" },
      {
        ...at(),
        type: "TOOL_CALL_START",
        toolCallId: "t1",
        toolCallName: "read_article",
      },
      { ...at(), type: "TOOL_CALL_ARGS", toolCallId: "t1", delta: '{"id":1}' },
      {
        ...at(),
        type: "TOOL_CALL_RESULT",
        messageId: "t1",
        toolCallId: "t1",
        content: '{"title":"記事"}',
      },
      { ...at(), type: "STEP_FINISHED", stepName: "researching_sources" },
    ])

    expect(result.timeline).toEqual([
      {
        kind: "step",
        stepName: "researching_sources",
        label: "記事を調査中",
        done: true,
      },
      {
        kind: "tool",
        toolCallId: "t1",
        name: "read_article",
        label: "記事を読む",
        args: '{"id":1}',
        result: '{"title":"記事"}',
        done: true,
      },
    ])
    expect(result.finished).toBe(false)
  })

  it("accumulates adopted articles from state deltas and ignores repeats", () => {
    const adopt = (articleId: string): AgUiEvent => ({
      ...at(),
      type: "STATE_DELTA",
      delta: [
        {
          op: "add",
          path: "/adoptedArticles/-",
          value: {
            articleId,
            title: `記事 ${articleId}`,
            url: `https://example.com/${articleId}`,
            sourceName: "テスト",
          },
        },
      ],
    })

    // 同じイベントを2回受けても重複しない（リプレイ後の重複配信に耐える）。
    const result = reduceAll([adopt("a"), adopt("b"), adopt("a")])

    expect(result.adoptedArticles.map((it) => it.articleId)).toEqual(["a", "b"])
  })

  it("tracks TTS progress through replace deltas", () => {
    const result = reduceAll([
      { ...at(), type: "STATE_SNAPSHOT", snapshot },
      {
        ...at(),
        type: "STATE_DELTA",
        delta: [
          {
            op: "replace",
            path: "/progress",
            value: { completed: 1, total: 4 },
          },
        ],
      },
      {
        ...at(),
        type: "STATE_DELTA",
        delta: [
          {
            op: "replace",
            path: "/progress",
            value: { completed: 3, total: 4 },
          },
        ],
      },
    ])

    expect(result.state?.progress).toEqual({ completed: 3, total: 4 })
  })

  it("marks the run finished on RUN_FINISHED", () => {
    const result = reduceAll([
      { ...at(), type: "STATE_SNAPSHOT", snapshot },
      { ...at(), type: "RUN_FINISHED", threadId: "job-1", runId: "job-1" },
    ])

    expect(result.finished).toBe(true)
    expect(result.state?.status).toBe("succeeded")
  })

  it("records a failure from RUN_ERROR", () => {
    const result = reduceAll([
      { ...at(), type: "STATE_SNAPSHOT", snapshot },
      {
        ...at(),
        type: "RUN_ERROR",
        message: "timeout",
        code: "provider-timeout",
      },
    ])

    expect(result.state?.status).toBe("failed")
    expect(result.state?.failure).toEqual({
      code: "provider-timeout",
      message: "timeout",
    })
  })

  it("distinguishes cancellation from failure", () => {
    const result = reduceAll([
      { ...at(), type: "STATE_SNAPSHOT", snapshot },
      { ...at(), type: "RUN_ERROR", message: "Canceled", code: "canceled" },
    ])

    expect(result.state?.status).toBe("canceled")
  })

  it("does not duplicate a step when STEP_STARTED arrives twice", () => {
    const result = reduceAll([
      { ...at(), type: "STEP_STARTED", stepName: "synthesizing_audio" },
      { ...at(), type: "STEP_STARTED", stepName: "synthesizing_audio" },
    ])

    expect(result.timeline).toHaveLength(1)
  })

  it("keeps unknown events from breaking the stream", () => {
    const result = reduceAll([
      { ...at(), type: "CUSTOM", name: "job.retrying", value: {} },
    ])

    expect(result).toEqual(emptyGenerationStream)
  })
})

describe("labels", () => {
  it("falls back to the raw tool name when unmapped", () => {
    expect(toolLabel("web_search")).toBe("Webで裏取り")
    expect(toolLabel("mystery_tool")).toBe("mystery_tool")
  })

  it("prompts for a selection when nothing is chosen", () => {
    expect(selectionLabel(0)).toBe("記事を選択してください")
    expect(selectionLabel(3)).toBe("3/20件を選択中")
  })
})
