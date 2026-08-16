import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { tagNameDraftAtom } from "../-atoms"
import { useTagVocabulary } from "./use-tag-vocabulary"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const tags = {
  items: [{ id: "tag-1", name: "AI", createdAt: "2026-08-01T00:00:00.000Z" }],
}
const suggestions = {
  items: [
    { name: "新語彙", occurrences: 3, lastSeenAt: "2026-08-10T00:00:00.000Z" },
  ],
}

async function renderState(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes)
  const rendered = renderHookWithProviders(() => useTagVocabulary())
  await waitFor(() => expect(rendered.result.current).not.toBeNull())
  return { ...rendered, ...stub }
}

describe("useTagVocabulary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exposes tags and AI suggestions", async () => {
    const { result } = await renderState([
      { path: "/v1/me/tags", body: tags },
      { path: "/v1/me/tag-suggestions", body: suggestions },
    ])

    await waitFor(() => expect(result.current.tags).toEqual(tags.items))
    expect(result.current.suggestions).toEqual(suggestions.items)
  })

  it("creates a tag from the name field and clears it", async () => {
    const { result, calls, store } = await renderState([
      { path: "/v1/me/tags", body: tags },
      { path: "/v1/me/tag-suggestions", body: suggestions },
      {
        method: "POST",
        path: "/v1/me/tags",
        status: 201,
        body: {
          id: "tag-2",
          name: "Web",
          createdAt: "2026-08-11T00:00:00.000Z",
        },
      },
    ])
    await waitFor(() => expect(result.current.tags).toEqual(tags.items))

    act(() => store.set(tagNameDraftAtom, "Web"))
    await act(async () => result.current.createTag())

    const created = calls.find((call) => call.method === "POST")
    expect(created?.body).toEqual({ name: "Web" })
    expect(store.get(tagNameDraftAtom)).toBe("")
  })

  it("promotes a suggestion into a tag", async () => {
    const { result, calls } = await renderState([
      { path: "/v1/me/tags", body: tags },
      { path: "/v1/me/tag-suggestions", body: suggestions },
      {
        method: "POST",
        path: "/v1/me/tag-suggestions/promote",
        status: 201,
        body: {
          id: "tag-3",
          name: "新語彙",
          createdAt: "2026-08-11T00:00:00.000Z",
        },
      },
    ])
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1))

    await act(async () => result.current.promoteSuggestion("新語彙"))

    const promoted = calls.find(
      (call) => call.method === "POST" && call.url.includes("promote")
    )
    expect(promoted?.body).toEqual({ name: "新語彙" })
  })

  it("deletes a tag", async () => {
    const { result, calls } = await renderState([
      { path: "/v1/me/tags", body: tags },
      { path: "/v1/me/tag-suggestions", body: suggestions },
      { method: "DELETE", path: "/v1/me/tags/tag-1", status: 204 },
    ])
    await waitFor(() => expect(result.current.tags).toEqual(tags.items))

    await act(async () => result.current.deleteTag("tag-1"))

    expect(
      calls.some(
        (call) => call.method === "DELETE" && call.url === "/v1/me/tags/tag-1"
      )
    ).toBe(true)
  })
})
