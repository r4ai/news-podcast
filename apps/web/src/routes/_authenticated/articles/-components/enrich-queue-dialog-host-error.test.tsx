import { render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { enrichQueueOpenAtom } from "../-atoms"
import { EnrichQueueDialogHost } from "./enrich-queue-dialog-host"

vi.mock("./enrich-queue-dialog", () => {
  throw new Error("chunk unavailable")
})

describe("EnrichQueueDialogHost の読み込み失敗", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it("記事画面を残し、再読み込みの導線を局所に出す", async () => {
    const store = createStore()
    store.set(enrichQueueOpenAtom, true)

    render(
      <Provider store={store}>
        <main>記事一覧</main>
        <EnrichQueueDialogHost />
      </Provider>
    )

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByText("記事一覧")).toBeDefined()
    expect(
      screen.getByRole("button", { name: "アプリを再読み込み" })
    ).toBeDefined()
  })
})
