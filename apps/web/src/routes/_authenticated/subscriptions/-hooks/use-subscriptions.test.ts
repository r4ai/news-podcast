import { act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { subscriptionsQueryOptions } from "@/features/subscriptions"
import type { Subscription } from "@/features/subscriptions"
import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { applyDraft, useSubscriptions } from "./use-subscriptions"

vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const items = [
  { id: "sub-1", feedId: "feed-1", enabled: true },
  { id: "sub-2", feedId: "feed-2", enabled: false },
] as unknown as Subscription[]

describe("applyDraft", () => {
  it("flips only the targeted subscription", () => {
    const next = applyDraft(items, {
      kind: "toggle",
      id: "sub-1",
      enabled: false,
    })
    expect(next[0]?.enabled).toBe(false)
    expect(next[1]?.enabled).toBe(false)
    expect(items[0]?.enabled).toBe(true)
  })

  it("drops the removed subscription without touching the rest", () => {
    expect(applyDraft(items, { kind: "remove", id: "sub-2" })).toEqual([
      items[0],
    ])
  })
})

describe("useSubscriptions", () => {
  async function renderList(routes: Parameters<typeof stubFetch>[0]) {
    const stub = stubFetch(routes)
    const rendered = renderHookWithProviders(() => useSubscriptions())
    await waitFor(() => expect(rendered.result.current.items).toHaveLength(2))
    return { ...rendered, ...stub }
  }

  it("sends the flipped value and settles on the server response", async () => {
    const { result, calls } = await renderList([
      { path: "/v1/me/feed-subscriptions", body: { items } },
      {
        method: "PATCH",
        path: "/v1/me/feed-subscriptions/sub-1",
        body: { ...items[0], enabled: false },
      },
    ])

    await act(async () => result.current.toggle(items[0]!))

    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.url).toBe("/v1/me/feed-subscriptions/sub-1")
    expect(patch?.body).toEqual({ enabled: false })
  })

  it("rolls back to the server state when the update fails", async () => {
    const { result } = await renderList([
      { path: "/v1/me/feed-subscriptions", body: { items } },
      {
        method: "DELETE",
        path: "/v1/me/feed-subscriptions/sub-2",
        status: 500,
        body: {},
      },
    ])

    await act(async () => result.current.removeItem(items[1]!))

    // useOptimisticの楽観値はTransition終了時にbase valueへ戻る
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items.map((item) => item.id)).toEqual([
      "sub-1",
      "sub-2",
    ])
  })

  it("reads the list through the shared subscriptions query key", async () => {
    const { queryClient } = await renderList([
      { path: "/v1/me/feed-subscriptions", body: { items } },
    ])

    expect(
      queryClient.getQueryData(subscriptionsQueryOptions.queryKey)
    ).toEqual({ items })
  })
})
