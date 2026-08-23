import { act, render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { describe, expect, it, vi } from "vitest"

import { enrichQueueOpenAtom } from "../-atoms"
import { EnrichQueueDialogHost } from "./enrich-queue-dialog-host"

vi.mock("./enrich-queue-dialog", () => ({
  ConnectedEnrichQueueDialog: () => (
    <div aria-label="AI処理キュー" role="dialog" />
  ),
}))

describe("EnrichQueueDialogHost", () => {
  it("閉じている間は何も描画せず、開いたときにダイアログを読み込む", async () => {
    const store = createStore()
    render(
      <Provider store={store}>
        <EnrichQueueDialogHost />
      </Provider>
    )

    expect(screen.queryByRole("dialog")).toBeNull()

    act(() => store.set(enrichQueueOpenAtom, true))

    expect(
      await screen.findByRole("dialog", { name: "AI処理キュー" })
    ).toBeDefined()
  })
})
