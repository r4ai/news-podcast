import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { generationStreamAtom } from "../atoms"
import { emptyGenerationStream } from "../model"

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

function jobPolls(calls: ReadonlyArray<{ url: string; method: string }>) {
  return calls.filter(
    (call) => call.url === "/v1/episode-jobs" && call.method === "GET"
  ).length
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

    store.set(generationStreamAtom, {
      ...emptyGenerationStream,
      connected: true,
    })
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
    store.set(generationStreamAtom, {
      ...emptyGenerationStream,
      connected: true,
    })

    await vi.waitFor(() => expect(result.current?.state).toBe("running"))

    store.set(generationStreamAtom, {
      ...emptyGenerationStream,
      connected: false,
    })
    await vi.advanceTimersByTimeAsync(0)
    const afterDrop = jobPolls(calls)

    await vi.advanceTimersByTimeAsync(2_500)

    expect(jobPolls(calls)).toBeGreaterThan(afterDrop)
  })
})

export {}
