import { waitFor } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { describe, expect, it, vi } from "vitest"

import type { EpisodeJobAgUiEvent } from "@news-podcast/contracts/agui"

import { renderHookWithProviders } from "@/shared/test/render"

import { generationStreamAtom } from "../atoms"
import { useGenerationStream } from "./use-generation-stream"

/**
 * hookは値を返さずatomへ書く (描画範囲を絞るため)。読み口はatomなので、
 * テストも同じatomを購読して確かめる。
 */
function useStreamUnderTest(jobId: string) {
  useGenerationStream(jobId)
  return useAtomValue(generationStreamAtom)
}

const frame = (event: EpisodeJobAgUiEvent, id?: number): string =>
  [
    ...(id === undefined ? [] : [`id: ${id}`]),
    `data: ${JSON.stringify(event)}`,
  ].join("\n")

function stubStream(body: string, chunkSize = 7) {
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
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < bytes.length; at += chunkSize) {
              controller.enqueue(bytes.slice(at, at + chunkSize))
            }
            controller.close()
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    })
  )
  return requests
}

const state = {
  jobId: "job-1",
  status: "running" as const,
  attempt: 1,
  maxAttempts: 4 as const,
  selectionMode: "automatic" as const,
  selectedArticles: [],
}

describe("useGenerationStream", () => {
  it("validates and folds chunked standard AG-UI events", async () => {
    const body = [
      frame({ type: "STATE_SNAPSHOT", snapshot: state }, 1),
      frame({ type: "STEP_STARTED", stepName: "selecting_articles" }, 2),
      frame(
        {
          type: "STATE_SNAPSHOT",
          snapshot: {
            ...state,
            selectedArticles: [
              { articleId: "a", title: "記事 a", sourceName: "Zenn" },
            ],
          },
        },
        3
      ),
      frame(
        {
          type: "RUN_FINISHED",
          threadId: "job-1",
          runId: "job-1:attempt:1",
          outcome: { type: "success" },
        },
        4
      ),
      "",
    ].join("\n\n")
    const requests = stubStream(body)
    const { result } = renderHookWithProviders(() =>
      useStreamUnderTest("job-1")
    )

    await waitFor(() => expect(result.current.finished).toBe(true))
    expect(requests[0]).toEqual({
      url: "/v1/episode-jobs/job-1/events",
      lastEventId: null,
    })
    expect(result.current.timeline[0]?.label).toBe("記事を選定中")
    expect(result.current.adoptedArticles[0]?.articleId).toBe("a")
  })

  it("rejects invalid events and ignores duplicate or out-of-order sequences", async () => {
    const body = [
      frame({ type: "STATE_SNAPSHOT", snapshot: state }, 2),
      frame({ type: "STEP_STARTED", stepName: "generating_script" }, 3),
      frame({ type: "STEP_STARTED", stepName: "storing_episode" }, 3),
      'id: 4\ndata: {"type":"CUSTOM","name":"not-supported","value":{}}',
      "",
    ].join("\n\n")
    stubStream(body)
    const { result } = renderHookWithProviders(() =>
      useStreamUnderTest("job-1")
    )

    await waitFor(() => expect(result.current.state?.status).toBe("running"))
    expect(result.current.timeline.map((entry) => entry.stepName)).toEqual([
      "generating_script",
    ])
  })
})
