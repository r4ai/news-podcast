import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AgUiEvent } from "@news-podcast/contracts/agui"

import { renderHookWithProviders } from "@/shared/test/render"

import { useGenerationStream } from "./use-generation-stream"

function frame(event: AgUiEvent, id?: number): string {
  return [
    ...(id === undefined ? [] : [`id: ${id}`]),
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
  ].join("\n")
}

/**
 * SSE を「1フレーム = 1チャンク」ではなく途中で切って流す。
 * フレーム境界をまたぐバッファリングが壊れていないかを見る。
 */
function stubStream(body: string, options: { chunkSize?: number } = {}) {
  const chunkSize = options.chunkSize ?? 7
  const requests: Array<{ url: string; lastEventId: string | null }> = []

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push({
        url: new URL(request.url, "http://web.test").pathname,
        lastEventId: request.headers.get("Last-Event-ID"),
      })
      const bytes = new TextEncoder().encode(body)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += chunkSize) {
            controller.enqueue(bytes.slice(at, at + chunkSize))
          }
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })
  )
  return { requests }
}

const snapshot: AgUiEvent = {
  type: "STATE_SNAPSHOT",
  timestamp: 1,
  snapshot: {
    jobId: "job-1",
    status: "running",
    attempt: 1,
    maxAttempts: 4,
    adoptedArticles: [],
  },
}

describe("useGenerationStream", () => {
  it("stays idle without an active job", async () => {
    const { requests } = stubStream("")
    const { result } = renderHookWithProviders(() =>
      useGenerationStream(undefined)
    )

    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(requests).toHaveLength(0)
  })

  it("folds a chunked event stream into timeline state", async () => {
    const body = [
      frame(snapshot),
      frame(
        { type: "STEP_STARTED", timestamp: 2, stepName: "researching_sources" },
        1
      ),
      frame(
        {
          type: "TOOL_CALL_START",
          timestamp: 3,
          toolCallId: "t1",
          toolCallName: "read_article",
        },
        2
      ),
      frame(
        {
          type: "STATE_DELTA",
          timestamp: 4,
          delta: [
            {
              op: "add",
              path: "/adoptedArticles/-",
              value: {
                articleId: "a",
                title: "記事 a",
                url: "https://example.com/a",
                sourceName: "Zenn",
              },
            },
          ],
        },
        3
      ),
      // ハートビートのコメント行が混ざっても壊れない。
      ": heartbeat",
      frame(
        {
          type: "RUN_FINISHED",
          timestamp: 5,
          threadId: "job-1",
          runId: "job-1",
        },
        4
      ),
      "",
    ].join("\n\n")

    const { requests } = stubStream(body)
    const { result } = renderHookWithProviders(() =>
      useGenerationStream("job-1")
    )

    await waitFor(() => expect(result.current.finished).toBe(true))

    expect(requests[0]?.url).toBe("/v1/episode-jobs/job-1/events")
    expect(requests[0]?.lastEventId).toBeNull()
    expect(result.current.timeline.map((entry) => entry.label)).toEqual([
      "記事を調査中",
      "記事を読む",
    ])
    expect(result.current.adoptedArticles).toEqual([
      {
        articleId: "a",
        title: "記事 a",
        url: "https://example.com/a",
        sourceName: "Zenn",
      },
    ])
    expect(result.current.state?.status).toBe("succeeded")
  })

  it("reports a disconnect so the caller can fall back to polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down")))
    )
    const { result } = renderHookWithProviders(() =>
      useGenerationStream("job-1")
    )

    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(result.current.timeline).toEqual([])
  })
})
