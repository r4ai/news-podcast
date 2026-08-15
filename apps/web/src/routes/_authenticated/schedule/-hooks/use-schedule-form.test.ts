import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { settingsQueryOptions } from "@/features/settings"
import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { useScheduleForm } from "./use-schedule-form"

vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const savedSettings = {
  generationSchedule: {
    enabled: true,
    localTime: "07:30",
    timeZone: "Asia/Tokyo",
  },
}

async function renderForm(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes)
  const rendered = renderHookWithProviders(() => useScheduleForm())
  await waitFor(() => expect(rendered.result.current).not.toBeNull())
  return { ...rendered, ...stub }
}

describe("useScheduleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("seeds the draft from the saved settings", async () => {
    const { result } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
    ])

    expect(result.current.draft).toEqual(savedSettings.generationSchedule)
    expect(result.current.saveState).toBe("idle")
    expect(result.current.error).toBeUndefined()
    expect(result.current.timeZones).toContainEqual({
      value: "Asia/Tokyo",
      label: expect.stringContaining("Asia/Tokyo"),
    })
  })

  it("saves the toggle immediately, without waiting for it to settle", async () => {
    const updated = {
      generationSchedule: { enabled: false, localTime: "07:30", timeZone: "Asia/Tokyo" },
    }
    const { result, calls, queryClient } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", body: updated },
    ])

    await act(async () => result.current.saveNow({ enabled: false }))

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual(updated)
    await waitFor(() =>
      expect(queryClient.getQueryData(settingsQueryOptions.queryKey)).toEqual(
        updated
      )
    )
    await waitFor(() => expect(result.current.saveState).toBe("saved"))
  })

  it("waits for a real quiet period before saving time/timezone edits", async () => {
    const updated = {
      generationSchedule: { enabled: true, localTime: "08:00", timeZone: "UTC" },
    }
    const { result, calls } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", body: updated },
    ])

    act(() => result.current.update({ localTime: "08:0" }))
    // 途中でさらに編集すると、デバウンスはそこからやり直しになる。
    await new Promise((resolve) => setTimeout(resolve, 400))
    act(() => result.current.update({ localTime: "08:00" }))
    act(() => result.current.update({ timeZone: "UTC" }))

    // 静止期間 (700ms) の途中では、まだ何も保存されていない。
    expect(calls.some((call) => call.method === "PATCH")).toBe(false)

    await waitFor(
      () =>
        expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(
          1
        ),
      { timeout: 2000 }
    )
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual(updated)
  })

  it("surfaces a field error when the server rejects the schedule", async () => {
    const { result } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", status: 422, body: {} },
    ])

    await act(async () => result.current.saveNow({ enabled: false }))

    await waitFor(() =>
      expect(result.current.error).toBe(
        "時刻とタイムゾーンを確認してください。"
      )
    )
    expect(result.current.saveState).toBe("error")
  })

  it("ignores a stale response when a newer save overtakes it", async () => {
    const { result, queryClient } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
    ])

    const pendingPatches: Array<{
      body: unknown
      resolve: () => void
    }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.method !== "PATCH") {
          return new Response(JSON.stringify(savedSettings), {
            headers: { "Content-Type": "application/json" },
          })
        }
        const body = await request.clone().json()
        await new Promise<void>((resolve) => {
          pendingPatches.push({ body, resolve })
        })
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        })
      })
    )

    // 古い保存 (enabled: false) を先に発行する。
    act(() => result.current.saveNow({ enabled: false }))
    await waitFor(() => expect(pendingPatches).toHaveLength(1))

    // まだ古い保存が完了していない間に、新しい保存 (enabled: true) を発行する。
    act(() => result.current.saveNow({ enabled: true }))
    await waitFor(() => expect(pendingPatches).toHaveLength(2))

    // 新しい方を先に解決し、古い方を後から解決する (順序が入れ替わるケース)。
    pendingPatches[1]?.resolve()
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(settingsQueryOptions.queryKey) as typeof savedSettings)
          .generationSchedule.enabled
      ).toBe(true)
    )

    pendingPatches[0]?.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 古い応答が後から届いても、新しい保存結果を上書きしてはいけない。
    expect(
      (queryClient.getQueryData(settingsQueryOptions.queryKey) as typeof savedSettings)
        .generationSchedule.enabled
    ).toBe(true)
  })

  it("does not lose a pending edit when the form unmounts right after it", async () => {
    const updated = {
      generationSchedule: { enabled: true, localTime: "09:15", timeZone: "Asia/Tokyo" },
    }
    const { result, calls, unmount } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", body: updated },
    ])

    act(() => result.current.update({ localTime: "09:15" }))
    act(() => unmount())

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual(updated)
  })
})
