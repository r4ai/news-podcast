import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { generationStreamAtom } from "../atoms"
import { emptyGenerationStream, type GenerationStream } from "../model"

// 実際の購読はしない。ストリームの状態はatomへ直接置いて動かす
// (`useGeneration`はそのatomしか見ない)。
vi.mock("./use-generation-stream", () => ({
  useGenerationStream: () => {},
}))
vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const { useGeneration } = await import("./use-generation")

const runningJob = {
  id: "job-1",
  status: "running",
  stage: "collect",
  attempt: 1,
  maxAttempts: 3,
  articleIds: [],
  deadlineAt: null,
  lastProgressAt: null,
  nextAttemptAt: null,
  stageProgress: null,
  failure: null,
}

const succeededJob = {
  ...runningJob,
  status: "succeeded",
  stage: null,
  episodeId: "episode-1",
}

const projectedEpisode = {
  id: "episode-1",
  title: "投影を待った番組",
  script: "台本",
  sources: [
    {
      title: "出典",
      url: "https://example.com/source",
      articleId: "article-1",
    },
  ],
  createdAt: "2026-08-19T00:00:00.000Z",
}

function routes(): Parameters<typeof stubFetch>[0] {
  return [
    { path: "/v1/episode-jobs", body: { items: [runningJob] } },
    { path: "/v1/episodes", body: { items: [] } },
    {
      path: "/v1/me/settings",
      body: {
        generationSchedule: {
          enabled: true,
          localTime: "07:00",
          timeZone: "Asia/Tokyo",
        },
        interestProfile: { text: "" },
        aiEnrich: { enabled: false },
      },
    },
    { path: "/v1/me/feed-subscriptions", body: { items: [] } },
    { path: "/v1/feeds", body: { items: [] } },
  ]
}

/** 最新ジョブのストリームが繋がった状態。idを揃えないと今のジョブとみなされない。 */
function connectStream(store: {
  set: (atom: typeof generationStreamAtom, value: GenerationStream) => void
}) {
  store.set(generationStreamAtom, {
    ...emptyGenerationStream,
    jobId: runningJob.id,
    connected: true,
  })
}

function jobPolls(calls: ReadonlyArray<{ url: string; method: string }>) {
  return calls.filter(
    (call) => call.url === "/v1/episode-jobs" && call.method === "GET"
  ).length
}

function stubProjection(availableOnAttempt: number | undefined) {
  let detailCalls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const path = new URL(request.url, "http://localhost").pathname
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        })

      if (path === "/v1/episode-jobs") {
        return json({ items: [succeededJob], page: { hasMore: false } })
      }
      if (path === "/v1/episodes") {
        return json({ items: [], page: { hasMore: false } })
      }
      if (path === "/v1/episodes/episode-1") {
        detailCalls += 1
        if (
          availableOnAttempt !== undefined &&
          detailCalls >= availableOnAttempt
        ) {
          return json(projectedEpisode)
        }
        return json(
          {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            code: "episode-not-found",
          },
          404
        )
      }
      return json({ message: "not stubbed" }, 404)
    })
  )
  return { detailCalls: () => detailCalls }
}

describe("useGeneration", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("polls the job while the stream is down", async () => {
    const { calls } = stubFetch(routes())
    const { result } = renderHookWithProviders(() => useGeneration())

    await vi.waitFor(() => expect(result.current?.state).toBe("running"))
    const before = jobPolls(calls)

    await vi.advanceTimersByTimeAsync(2_500)

    // 1秒間隔なので、2.5秒でも複数回追いかけている。
    expect(jobPolls(calls)).toBeGreaterThan(before)
  })

  it("stops polling as soon as the stream is connected", async () => {
    const { calls } = stubFetch(routes())
    const { result, store } = renderHookWithProviders(() => useGeneration())

    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    connectStream(store)
    await vi.advanceTimersByTimeAsync(0)
    const afterConnect = jobPolls(calls)

    await vi.advanceTimersByTimeAsync(3_000)

    // SSEが正本になったので、フォールバックのポーリングは眠る。
    expect(jobPolls(calls)).toBe(afterConnect)
    expect(result.current?.streaming).toBe(true)
  })

  it("resumes polling when the stream drops", async () => {
    const { calls } = stubFetch(routes())
    const { result, store } = renderHookWithProviders(() => useGeneration())
    connectStream(store)

    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    store.set(generationStreamAtom, emptyGenerationStream)
    await vi.advanceTimersByTimeAsync(0)
    const afterDrop = jobPolls(calls)

    await vi.advanceTimersByTimeAsync(2_500)

    expect(jobPolls(calls)).toBeGreaterThan(afterDrop)
  })

  /**
   * 前のジョブのストリームでポーリングを止めない。止めると、新しいジョブの
   * 進捗を誰も追わなくなる（SSEの購読が張り替わるまでの隙に起きうる）。
   */
  it("keeps polling while the connected stream belongs to another job", async () => {
    const { calls } = stubFetch(routes())
    const { result, store } = renderHookWithProviders(() => useGeneration())

    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    store.set(generationStreamAtom, {
      ...emptyGenerationStream,
      jobId: "job-previous",
      connected: true,
    })
    await vi.advanceTimersByTimeAsync(0)
    const before = jobPolls(calls)

    await vi.advanceTimersByTimeAsync(2_500)

    expect(jobPolls(calls)).toBeGreaterThan(before)
    // 前のジョブの状態を「今のジョブのライブ表示」として出さない。
    expect(result.current?.streaming).toBe(false)
  })

  it("keeps the succeeded job in projection wait until its episode becomes readable", async () => {
    const projection = stubProjection(3)
    const { result } = renderHookWithProviders(() => useGeneration())

    await vi.waitFor(() => expect(result.current?.state).toBe("projecting"))
    expect(result.current?.episode).toBeUndefined()

    await act(async () => vi.advanceTimersByTimeAsync(2_000))

    await vi.waitFor(() => expect(result.current?.state).toBe("succeeded"))
    expect(result.current?.episode?.title).toBe("投影を待った番組")
    expect(projection.detailCalls()).toBe(3)
  })

  it("stops bounded projection retries and exposes a manual recovery action", async () => {
    const projection = stubProjection(undefined)
    const { result } = renderHookWithProviders(() => useGeneration())

    await vi.waitFor(() => expect(result.current?.state).toBe("projecting"))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    await vi.waitFor(() =>
      expect(result.current?.state).toBe("projection-failed")
    )
    const attemptsAtTimeout = projection.detailCalls()
    expect(attemptsAtTimeout).toBeGreaterThan(1)

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(projection.detailCalls()).toBe(attemptsAtTimeout)

    await act(async () => result.current?.onRetryProjection())
    expect(projection.detailCalls()).toBe(attemptsAtTimeout + 1)
  })
})

export {}
