import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { OfflineNotice } from "./offline-notice"

/**
 * `navigator.onLine`は読み取り専用なので、記述子ごと差し替えて回線を模す。
 * 状態変化の合図は`online`/`offline`イベント。
 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  })
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"))
  })
}

afterEach(() => setOnline(true))

describe("OfflineNotice", () => {
  it("繋がっている間は何も出さない。常設の器を置かない", () => {
    render(<OfflineNotice />)

    expect(screen.queryByRole("status")).toBeNull()
  })

  it("切れたら理由を出す。パネルごとの取得失敗より先に原因を言う", () => {
    render(<OfflineNotice />)

    setOnline(false)

    expect(screen.getByRole("status").textContent).toContain("オフラインです")
  })

  it("戻ったら黙って消える。押させる操作を残さない", () => {
    render(<OfflineNotice />)
    setOnline(false)

    setOnline(true)

    expect(screen.queryByRole("status")).toBeNull()
  })
})
