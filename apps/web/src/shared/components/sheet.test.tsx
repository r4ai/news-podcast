import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@workspace/ui/components/sheet"

function Example() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>開く</button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent onDismiss={() => setOpen(false)}>
          <SheetTitle>操作</SheetTitle>
          <SheetDescription>ジェスチャーの検証</SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  )
}

function press(pointerId = 1) {
  const handle = screen.getByRole("button", { name: "閉じる" })
  fireEvent.pointerDown(handle, {
    pointerId,
    button: 0,
    clientX: 100,
    clientY: 100,
  })
  return handle
}

function move(dx: number, dy: number, pointerId = 1) {
  fireEvent.pointerMove(window, {
    pointerId,
    clientX: 100 + dx,
    clientY: 100 + dy,
  })
}

function release(handle: HTMLElement, pointerId = 1) {
  fireEvent.pointerUp(handle, { pointerId })
  fireEvent(
    handle,
    new PointerEvent("click", { pointerId, detail: 1, bubbles: true })
  )
}

/**
 * 状態遷移表（Popupの実物と窓のイベントを使う）。
 * idle → primary down → dragging
 * dragging → tap / 96px以上の下向きdrag → closed
 * dragging → 小さいdrag / 横・上drag / cancel / blur → open
 * dragging → 別の指 → unchanged
 * dragging → Escape → closed → reopen → idle
 */
describe("Sheetのジェスチャー", () => {
  it.each([
    { dx: 0, dy: 0, closes: true },
    { dx: 0, dy: 30, closes: false },
    { dx: 0, dy: 95, closes: false },
    { dx: 0, dy: 96, closes: true },
    { dx: 0, dy: 160, closes: true },
    { dx: 30, dy: 0, closes: false },
    { dx: 0, dy: -30, closes: false },
  ])("移動($dx,$dy)を離すと closes=$closes", async ({ dx, dy, closes }) => {
    render(<Example />)
    const handle = press()
    move(dx, dy)
    release(handle)
    await waitFor(() =>
      expect(screen.queryByRole("dialog") === null).toBe(closes)
    )
  })

  it.each(["pointercancel", "blur"])(
    "%sで引き代と所有者を破棄し、次のtapで閉じる",
    async (event) => {
      render(<Example />)
      press()
      move(0, 120)
      expect(screen.getByRole("dialog").style.transform).toBe(
        "translateY(120px)"
      )
      fireEvent(
        window,
        event === "blur"
          ? new Event("blur")
          : new PointerEvent("pointercancel", { pointerId: 1 })
      )
      expect(screen.getByRole("dialog").style.transform).toBe("")
      release(press(2), 2)
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    }
  )

  it.each(["owner-first", "second-first"] as const)(
    "別の指で所有権やtapを奪わない: %s",
    (order) => {
      render(<Example />)
      const handle = press()
      move(0, 30)
      press(2)
      move(0, 160, 2)
      expect(screen.getByRole("dialog").style.transform).toBe(
        "translateY(30px)"
      )
      for (const id of order === "owner-first" ? [1, 2] : [2, 1])
        release(handle, id)
      expect(screen.getByRole("dialog").style.transform).toBe("")
    }
  )

  it("ドラッグ中のEscape後、開き直した面へ古い指を持ち越さない", async () => {
    const user = userEvent.setup()
    render(<Example />)
    press()
    move(0, 120)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await user.click(screen.getByRole("button", { name: "開く" }))
    move(0, 160)
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(screen.getByRole("dialog").style.transform).toBe("")
  })
})
