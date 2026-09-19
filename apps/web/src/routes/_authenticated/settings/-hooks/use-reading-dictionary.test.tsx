import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { expect, it, vi } from "vitest"

import { TestProviders, createTestQueryClient } from "@/shared/test/render"
import type { ReadingDictionaryPatch } from "../-model"
import { useReadingDictionary } from "./use-reading-dictionary"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Every nonempty subset of the three optional fields must survive the update.
const combinations = [1, 2, 3, 4, 5, 6, 7]
it.each(combinations)(
  "persists every supplied field (mask %i)",
  async (mask) => {
    const patch: ReadingDictionaryPatch = {
      ...(mask & 1 ? { surface: "AI" } : {}),
      ...(mask & 2 ? { reading: "えーあい" } : {}),
      ...(mask & 4 ? { accentType: 0 } : {}),
    }
    let saved = {
      id: "entry",
      surface: "Old",
      reading: "オールド",
      accentType: 1,
      source: "manual",
      createdAt: "2026-08-12T00:00:00.000Z",
    }
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.method === "PUT")
          saved = { ...saved, ...(await request.json()) }
        return Response.json(
          request.method === "PUT" ? saved : { items: [saved] }
        )
      }
    )
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestProviders queryClient={queryClient}>{children}</TestProviders>
    )
    const { result } = renderHook(() => useReadingDictionary(), { wrapper })
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    await act(async () => result.current.updateEntry("entry", patch))
    const expected = { ...patch, ...(mask & 2 ? { reading: "エーアイ" } : {}) }
    await waitFor(() =>
      expect(result.current.entries[0]).toMatchObject(expected)
    )
    expect(saved).toMatchObject(expected)
  }
)
