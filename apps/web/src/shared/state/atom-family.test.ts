import { atom, createStore } from "jotai"
import { describe, expect, it, vi } from "vitest"

// Transitions: absent → created → reused; different key → isolated;
// removed → recreated; removing a missing key → other entries unchanged.
describe("application atom families", () => {
  it("initializes query, player and dictionary families without deprecation warnings", async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { keyedAtomFamily } = await import("./query")
    keyedAtomFamily(
      (id: string) => atom(id),
      (id) => id
    )("query")
    await import("@/features/player/atoms")
    await import("@/routes/_authenticated/settings/-atoms")
    expect(warn.mock.calls.flat().join("\n")).not.toContain(
      "atomFamily is deprecated"
    )
  })

  it("reuses value-equivalent query keys and releases only the removed key", async () => {
    const { keyedAtomFamily } = await import("./query")
    const family = keyedAtomFamily(
      ({ id }: { id: string }) => atom(id),
      ({ id }) => id
    )
    const first = family({ id: "a" })
    const other = family({ id: "b" })
    expect(family({ id: "a" })).toBe(first)
    expect(other).not.toBe(first)
    family.remove({ id: "a" })
    expect([...family.getParams()]).toEqual([{ id: "b" }])
    expect(family({ id: "a" })).not.toBe(first)
    family.remove({ id: "missing" })
    expect(family({ id: "b" })).toBe(other)
  })

  it("isolates simultaneous dictionary drafts and forgets deleted rows", async () => {
    const { readingEntryEditAtom, forgetReadingEntryEdit } =
      await import("@/routes/_authenticated/settings/-atoms")
    const store = createStore()
    const first = readingEntryEditAtom("a")
    const other = readingEntryEditAtom("b")
    const draft = { surface: "AI", reading: "エーアイ" }
    store.set(first, draft)
    store.set(other, { surface: "API", reading: "エーピーアイ" })
    expect(readingEntryEditAtom("a")).toBe(first)
    expect(store.get(first)).toEqual(draft)
    expect(store.get(other)?.surface).toBe("API")
    forgetReadingEntryEdit("a")
    expect([...readingEntryEditAtom.getParams()]).not.toContain("a")
    expect(store.get(readingEntryEditAtom("a"))).toBeNull()
    expect(readingEntryEditAtom("b")).toBe(other)
    expect(store.get(other)?.surface).toBe("API")
    forgetReadingEntryEdit("a")
    forgetReadingEntryEdit("b")
  })
})
