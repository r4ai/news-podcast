import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"
import { useActiveHeading } from "./use-active-heading"

/**
 * jsdomはIntersectionObserverもレイアウトも持たないので、両方を手で与える。
 * `notify()`が「読み位置をまたいだ」合図、`scrollTo()`が見出しの位置を動かす。
 */
function setUpHeadings(ids: readonly string[]) {
  const tops = new Map<string, number>()
  for (const [index, id] of ids.entries()) {
    const heading = document.createElement("h3")
    heading.id = id
    heading.textContent = id
    // 初期状態は全て読み位置より下(= まだどの節にも入っていない)。
    tops.set(id, 1000 + index * 1000)
    heading.getBoundingClientRect = () =>
      ({ top: tops.get(id) ?? 0 }) as DOMRect
    document.body.append(heading)
  }

  let notify: () => void = () => {}
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: () => void) {
        notify = callback
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    }
  )

  return {
    /** 全見出しを`offset`px上へ動かす(= 下へスクロールする)。 */
    scrollBy(offset: number) {
      for (const [id, top] of tops) tops.set(id, top - offset)
    },
    notify: () => act(() => notify()),
  }
}

const outline = (ids: readonly string[]): readonly HeadingOutlineEntry[] =>
  ids.map((id, index) => ({ id, level: 3 + index, text: id }))

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("useActiveHeading", () => {
  // jsdomのinnerHeightは768。読み位置は768 * 0.3 = 230.4px。
  const readingLine = 768 * 0.3

  it("selects nothing before the first heading reaches the reading line", () => {
    setUpHeadings(["a", "b"])
    const { result } = renderHook(() => useActiveHeading(outline(["a", "b"])))

    expect(result.current).toBeUndefined()
  })

  it("selects a heading once it crosses the reading line", () => {
    const view = setUpHeadings(["a", "b"])
    const { result } = renderHook(() => useActiveHeading(outline(["a", "b"])))

    view.scrollBy(1000 - readingLine + 1)
    view.notify()

    expect(result.current).toBe("a")
  })

  it("keeps the section active after its heading scrolls out of view", () => {
    const view = setUpHeadings(["a", "b"])
    const { result } = renderHook(() => useActiveHeading(outline(["a", "b"])))

    // aが読み位置を越えて、さらに画面外(上)まで流れる。bはまだ下にいる。
    view.scrollBy(1000 - readingLine + 1)
    view.notify()
    view.scrollBy(600)
    view.notify()

    expect(result.current).toBe("a")
  })

  it("advances to the next heading only when it reaches the reading line", () => {
    const view = setUpHeadings(["a", "b"])
    const { result } = renderHook(() => useActiveHeading(outline(["a", "b"])))

    view.scrollBy(1000 - readingLine + 1)
    view.notify()
    // bは初期2000。ここまでで(1000 - readingLine + 1)動いたので、
    // あとreadingLineに届くまで999px足りない。
    view.scrollBy(998)
    view.notify()
    expect(result.current).toBe("a")

    view.scrollBy(2)
    view.notify()
    expect(result.current).toBe("b")
  })

  it("goes back to the previous heading when scrolling up", () => {
    const view = setUpHeadings(["a", "b"])
    const { result } = renderHook(() => useActiveHeading(outline(["a", "b"])))

    view.scrollBy(2000 - readingLine + 1)
    view.notify()
    expect(result.current).toBe("b")

    view.scrollBy(-200)
    view.notify()
    expect(result.current).toBe("a")
  })

  it("selects nothing when the outline is empty", () => {
    setUpHeadings([])
    const { result } = renderHook(() => useActiveHeading(outline([])))

    expect(result.current).toBeUndefined()
  })

  it("selects nothing when the headings are not in the document yet", () => {
    setUpHeadings(["a"])
    const { result } = renderHook(() => useActiveHeading(outline(["missing"])))

    expect(result.current).toBeUndefined()
  })
})
