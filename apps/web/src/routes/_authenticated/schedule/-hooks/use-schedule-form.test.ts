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
    expect(result.current.canSubmit).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it("sends the edited draft and caches the server response", async () => {
    const updated = {
      generationSchedule: {
        enabled: false,
        localTime: "22:00",
        timeZone: "UTC",
      },
    }
    const { result, calls, queryClient } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", body: updated },
    ])

    act(() => result.current.update({ localTime: "22:00", timeZone: "UTC" }))
    await act(async () => result.current.submit())

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({
      generationSchedule: {
        enabled: true,
        localTime: "22:00",
        timeZone: "UTC",
      },
    })
    // 確定値はserver responseで、楽観値ではない
    await waitFor(() =>
      expect(queryClient.getQueryData(settingsQueryOptions.queryKey)).toEqual(
        updated
      )
    )
  })

  it("surfaces a field error when the server rejects the schedule", async () => {
    const { result } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { method: "PATCH", path: "/v1/me/settings", status: 422, body: {} },
    ])

    await act(async () => result.current.submit())

    await waitFor(() =>
      expect(result.current.error).toBe(
        "時刻とタイムゾーンを確認してください。"
      )
    )
  })
})
