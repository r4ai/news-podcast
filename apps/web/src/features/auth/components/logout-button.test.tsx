import { QueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { currentTrackAtom, progressMapAtom } from "@/features/player/atoms"
import { createTestStore, TestProviders } from "@/shared/test/render"
import { resetToastSink } from "@/shared/ui/toast"
import { LogoutButton } from "./logout-button"

const auth = {
  authenticated: true,
  userId: "owner-a",
  loginMethods: { development: true, google: false },
} as const

const track = {
  episodeId: "episode-a",
  title: "Owner A の番組",
  createdAt: "2026-08-23T00:00:00.000Z",
} as const

function renderButton(
  logout: () => Promise<void>,
  navigate: (path: string) => void
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const store = createTestStore(queryClient)
  store.set(currentTrackAtom, track)
  store.set(progressMapAtom, {
    [track.episodeId]: { position: 10, duration: 30, updatedAt: 1 },
  })
  queryClient.setQueryData(["owner", "articles"], ["owner-a-private"])

  render(
    <TestProviders queryClient={queryClient} store={store}>
      <LogoutButton auth={auth} logout={logout} navigateToLogin={navigate} />
    </TestProviders>
  )
  return { queryClient, store }
}

beforeEach(() => {
  localStorage.clear()
  resetToastSink()
})

describe("LogoutButton", () => {
  it("clears playback, owner cache, and persisted data only after server success", async () => {
    let finishLogout!: () => void
    const logout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve
        })
    )
    const navigate = vi.fn()
    const { queryClient, store } = renderButton(logout, navigate)
    const button = screen.getByRole("button", { name: "ログアウト" })

    await userEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(store.get(currentTrackAtom)).toEqual(track)
    expect(queryClient.getQueryData(["owner", "articles"])).toEqual([
      "owner-a-private",
    ])

    finishLogout()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/login"))
    expect(store.get(currentTrackAtom)).toBeNull()
    expect(store.get(progressMapAtom)).toEqual({})
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(localStorage.getItem("player.track")).toBeNull()
    expect(localStorage.getItem("player.progress")).toBeNull()
  })

  it("retains authenticated state after failure and allows a retry", async () => {
    const logout = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(undefined)
    const navigate = vi.fn()
    const { queryClient, store } = renderButton(logout, navigate)
    const button = screen.getByRole("button", { name: "ログアウト" })

    await userEvent.click(button)

    await vi.waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "ログアウトできませんでした"
    )
    expect(store.get(currentTrackAtom)).toEqual(track)
    expect(queryClient.getQueryData(["owner", "articles"])).toEqual([
      "owner-a-private",
    ])
    expect(navigate).not.toHaveBeenCalled()

    await userEvent.click(button)
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/login"))
    expect(logout).toHaveBeenCalledTimes(2)
  })
})
