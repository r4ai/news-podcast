import { act, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { usePickerSources } from "./use-picker-sources"

const subscription = { id: "subscription", feedId: "feed", enabled: true }
const job = (status: string, extra = {}) => ({
  jobId: "job",
  feedId: "feed",
  status,
  failed: 0,
  createdAt: "2026-09-20T00:00:00.000Z",
  ...extra,
})

function sources(
  subscriptions: unknown[],
  jobs: unknown[],
  errorPath?: string
) {
  return stubFetch([
    {
      path: "/v1/me/feed-subscriptions",
      status: errorPath === "subscriptions" ? 503 : 200,
      body: { items: subscriptions },
    },
    {
      path: "/v1/me/feed-sync-jobs",
      status: errorPath === "jobs" ? 503 : 200,
      body: { items: jobs },
    },
  ])
}

describe("picker sources", () => {
  it.each([
    {
      name: "no subscriptions",
      subscriptions: [],
      jobs: [],
      expected: "no-subscriptions",
    },
    {
      name: "all paused",
      subscriptions: [{ ...subscription, enabled: false }],
      jobs: [job("failed")],
      expected: "paused",
    },
    {
      name: "not yet queued",
      subscriptions: [subscription],
      jobs: [],
      expected: "empty",
    },
    {
      name: "queued",
      subscriptions: [subscription],
      jobs: [job("queued")],
      expected: "syncing",
    },
    {
      name: "processing",
      subscriptions: [subscription],
      jobs: [job("processing")],
      expected: "syncing",
    },
    {
      name: "failed",
      subscriptions: [subscription],
      jobs: [job("failed")],
      expected: "sync-failed",
    },
    {
      name: "partial failure",
      subscriptions: [subscription],
      jobs: [job("succeeded", { failed: 1 })],
      expected: "sync-failed",
    },
    {
      name: "completed without candidates",
      subscriptions: [subscription],
      jobs: [job("succeeded")],
      expected: "empty",
    },
    {
      name: "recovered after old failure",
      subscriptions: [subscription],
      jobs: [
        job("failed", { createdAt: "2026-09-19T00:00:00.000Z" }),
        job("succeeded"),
      ],
      expected: "empty",
    },
    {
      name: "removed feed failure",
      subscriptions: [subscription],
      jobs: [job("failed", { feedId: "removed" })],
      expected: "empty",
    },
    {
      name: "paused feed job",
      subscriptions: [
        subscription,
        { ...subscription, feedId: "paused", enabled: false },
      ],
      jobs: [job("processing", { feedId: "paused" })],
      expected: "empty",
    },
  ])("classifies $name", async ({ subscriptions, jobs, expected }) => {
    sources(subscriptions, jobs)
    const { result } = renderHookWithProviders(() => usePickerSources(true))
    await waitFor(() => expect(result.current.state).toBe(expected))
  })

  it.each(["subscriptions", "jobs"])(
    "does not mistake unavailable %s for no sources",
    async (errorPath) => {
      sources([subscription], [], errorPath)
      const { result } = renderHookWithProviders(() => usePickerSources(true))
      await waitFor(() => expect(result.current.state).toBe("source-error"))
    }
  )

  it("does not fetch outside an empty, open picker", () => {
    const { calls } = sources([], [])
    const { result } = renderHookWithProviders(() => usePickerSources(false))
    expect(calls).toEqual([])
    expect(result.current.state).toBe("checking")
  })

  it("keeps in-flight work visible while another feed has failed", async () => {
    sources(
      [subscription, { ...subscription, feedId: "other" }],
      [job("failed"), job("queued", { feedId: "other" })]
    )
    const { result } = renderHookWithProviders(() => usePickerSources(true))
    await waitFor(() => expect(result.current.state).toBe("syncing"))
  })

  it("refreshes a failed sync into the completed state", async () => {
    sources([subscription], [job("failed")])
    const { result } = renderHookWithProviders(() => usePickerSources(true))
    await waitFor(() => expect(result.current.state).toBe("sync-failed"))
    sources([subscription], [job("succeeded")])
    act(() => result.current.onRetry())
    await waitFor(() => expect(result.current.state).toBe("empty"))
  })
})
