import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDebouncedCallback } from "./use-debounced-callback"

describe("useDebouncedCallback", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("collapses a burst into the last call", () => {
    const spy = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(spy, 300))

    act(() => {
      result.current("a")
      result.current("ab")
      result.current("abc")
    })
    expect(spy).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(300))
    expect(spy).toHaveBeenCalledExactlyOnceWith("abc")
  })

  it("uses the latest callback without restarting the timer", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ callback }: { callback: (value: string) => void }) =>
        useDebouncedCallback(callback, 300),
      { initialProps: { callback: first } }
    )

    act(() => result.current("x"))
    act(() => void vi.advanceTimersByTime(200))
    rerender({ callback: second })
    act(() => void vi.advanceTimersByTime(100))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith("x")
  })

  it("runs a waiting call immediately on flush", () => {
    const spy = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(spy, 300))

    act(() => result.current("now"))
    act(() => result.current.flush())

    expect(spy).toHaveBeenCalledExactlyOnceWith("now")
    // flush済みなので、後からタイマーが切れても二重に呼ばない。
    act(() => void vi.advanceTimersByTime(300))
    expect(spy).toHaveBeenCalledOnce()
  })

  it("drops a waiting call on unmount by default", () => {
    const spy = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(spy, 300))

    act(() => result.current("dropped"))
    unmount()
    act(() => void vi.advanceTimersByTime(300))

    expect(spy).not.toHaveBeenCalled()
  })

  it("flushes a waiting call on unmount when asked", () => {
    const spy = vi.fn()
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(spy, 300, { flushOnUnmount: true })
    )

    act(() => result.current("kept"))
    unmount()

    expect(spy).toHaveBeenCalledExactlyOnceWith("kept")
  })
})
