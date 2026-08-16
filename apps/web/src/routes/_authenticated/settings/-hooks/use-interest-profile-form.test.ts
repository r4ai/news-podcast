import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { useInterestProfileForm } from "./use-interest-profile-form"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const savedSettings = {
  generationSchedule: {
    enabled: true,
    localTime: "07:30",
    timeZone: "Asia/Tokyo",
  },
  interestProfile: { include: "AI", exclude: "野球" },
}
const facets = {
  states: { all: 42, unread: 10, saved: 1, later: 0 },
  feeds: [],
  aiPending: 3,
}

async function renderForm(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes)
  const rendered = renderHookWithProviders(() => useInterestProfileForm())
  await waitFor(() => expect(rendered.result.current).not.toBeNull())
  return { ...rendered, ...stub }
}

describe("useInterestProfileForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("seeds the draft from the saved interest profile", async () => {
    const { result } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
    ])

    await waitFor(() =>
      expect(result.current.draft).toEqual(savedSettings.interestProfile)
    )
    // 開いた直後は保存済みと同じ内容なので、保存する意味がない。
    expect(result.current.dirty).toBe(false)
    expect(result.current.canSubmit).toBe(false)
  })

  it("becomes submittable once the draft differs from what is saved", async () => {
    const { result } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
    ])
    await waitFor(() => expect(result.current.draft).toBeDefined())

    act(() => result.current.update({ include: "AI 半導体" }))
    expect(result.current.dirty).toBe(true)
    expect(result.current.canSubmit).toBe(true)

    // 元の内容へ戻せば、また押せなくなる。
    act(() => result.current.discard())
    expect(result.current.dirty).toBe(false)
    expect(result.current.draft).toEqual(savedSettings.interestProfile)
  })

  it("does not save until the confirmation dialog is accepted", async () => {
    const { result, calls } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "PATCH",
        path: "/v1/me/settings",
        body: {
          ...savedSettings,
          interestProfile: { include: "AI 半導体", exclude: "野球" },
        },
      },
    ])
    await waitFor(() => expect(result.current.draft).toBeDefined())

    act(() => result.current.update({ include: "AI 半導体" }))
    act(() => result.current.requestSave())
    expect(result.current.confirmOpen).toBe(true)
    expect(calls.some((call) => call.method === "PATCH")).toBe(false)

    await act(async () => result.current.confirmSave())

    expect(result.current.confirmOpen).toBe(false)
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({
      interestProfile: { include: "AI 半導体", exclude: "野球" },
    })
  })

  it("closes the dialog without saving when canceled", async () => {
    const { result, calls } = await renderForm([
      { path: "/v1/me/settings", body: savedSettings },
      { path: "/v1/me/articles/facets", body: facets },
    ])
    await waitFor(() => expect(result.current.draft).toBeDefined())

    act(() => result.current.requestSave())
    act(() => result.current.cancelSave())

    expect(result.current.confirmOpen).toBe(false)
    expect(calls.some((call) => call.method === "PATCH")).toBe(false)
  })
})
