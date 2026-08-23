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

const failedJob = {
  ...runningJob,
  id: "00000000-0000-4000-8000-000000000085",
  status: "failed",
  stage: null,
  failure: {
    code: "script_timeout",
    message: "script_timeout",
    retryable: false,
  },
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

function stubProjection(
  availableOnAttempt: number | undefined,
  job: typeof succeededJob | typeof runningJob = succeededJob
) {
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
        return json({ items: [job], page: { hasMore: false } })
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

  it("uses the episode ID from streamed success while the REST job still reports running", async () => {
    const projection = stubProjection(2, runningJob)
    const { result, store } = renderHookWithProviders(() => useGeneration())
    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    store.set(generationStreamAtom, {
      ...emptyGenerationStream,
      jobId: runningJob.id,
      connected: true,
      finished: true,
      state: {
        jobId: runningJob.id,
        status: "succeeded",
        attempt: 1,
        maxAttempts: 4,
        selectionMode: "manual",
        selectedArticles: [],
        episodeId: "episode-1",
      },
    })

    await vi.waitFor(() => expect(result.current?.state).toBe("projecting"))
    expect(projection.detailCalls()).toBe(1)

    await act(async () => vi.advanceTimersByTimeAsync(500))
    await vi.waitFor(() => expect(result.current?.state).toBe("succeeded"))
    expect(result.current?.episode?.title).toBe("投影を待った番組")
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

  it("reuses the create key after an ambiguous response loss until the selection changes", async () => {
    vi.useRealTimers()
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000101")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000102")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000103")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000104")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000105")
    const firstArticleId = "00000000-0000-4000-8000-000000000001"
    const secondArticleId = "00000000-0000-4000-8000-000000000002"
    const { calls } = stubFetch([
      ...routes(),
      {
        method: "POST",
        path: "/v1/episode-jobs",
        status: 503,
        body: { code: "service_unavailable", message: "response lost" },
      },
    ])
    const { result } = renderHookWithProviders(() => useGeneration())
    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    act(() =>
      result.current?.onConfirmGenerate([firstArticleId, secondArticleId])
    )
    await vi.waitFor(() => expect(randomUUID).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1)
    )
    act(() =>
      result.current?.onConfirmGenerate([firstArticleId, secondArticleId])
    )
    await vi.waitFor(() => {
      const posts = calls.filter((call) => call.method === "POST")
      expect(posts).toHaveLength(2)
    })

    act(() => result.current?.onConfirmGenerate([firstArticleId]))
    await vi.waitFor(() => {
      const posts = calls.filter((call) => call.method === "POST")
      expect(posts).toHaveLength(3)
      expect(posts[0]?.headers.get("idempotency-key")).toBe(
        posts[1]?.headers.get("idempotency-key")
      )
      expect(posts[2]?.headers.get("idempotency-key")).not.toBe(
        posts[1]?.headers.get("idempotency-key")
      )
    })

    act(() => result.current?.onPickerOpenChange(false))
    act(() => result.current?.onConfirmGenerate([firstArticleId]))
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(4)
    )
    act(() => result.current?.onGenerate())
    act(() => result.current?.onConfirmGenerate([firstArticleId]))
    await vi.waitFor(() => {
      const posts = calls.filter((call) => call.method === "POST")
      expect(posts).toHaveLength(5)
      expect(posts[3]?.headers.get("idempotency-key")).not.toBe(
        posts[2]?.headers.get("idempotency-key")
      )
      expect(posts[4]?.headers.get("idempotency-key")).not.toBe(
        posts[3]?.headers.get("idempotency-key")
      )
    })
  })

  it("reuses the retry key after an ambiguous response loss", async () => {
    vi.useRealTimers()
    const { calls } = stubFetch([
      { path: "/v1/episode-jobs", body: { items: [failedJob] } },
      ...routes().slice(1),
      {
        method: "POST",
        path: `/v1/episode-jobs/${failedJob.id}/retry`,
        status: 503,
        body: { code: "service_unavailable", message: "response lost" },
      },
    ])
    const { result } = renderHookWithProviders(() => useGeneration())
    await vi.waitFor(() => expect(result.current?.state).toBe("failed"))

    act(() => result.current?.onRetry())
    await vi.waitFor(() => expect(result.current?.submitError).toBeDefined())
    act(() => result.current?.onRetry())
    await vi.waitFor(() => {
      const retries = calls.filter((call) => call.method === "POST")
      expect(retries).toHaveLength(2)
      expect(retries[0]?.headers.get("idempotency-key")).not.toBeNull()
      expect(retries[0]?.headers.get("idempotency-key")).toBe(
        retries[1]?.headers.get("idempotency-key")
      )
    })
  })
})

export {}
