import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Feed } from "@/features/subscriptions"
import {
  AddFeedCardView,
  type CatalogState,
  type RegistrationState,
} from "./add-feed-card"

const feeds = [
  { id: "feed-1", name: "Zenn", siteUrl: "", feedUrl: "https://zenn.dev/feed" },
] as unknown as Feed[]

function catalogState(overrides: Partial<CatalogState> = {}): CatalogState {
  return {
    candidates: feeds,
    selectedFeedId: "",
    pending: false,
    canAdd: false,
    setSelectedFeedId: vi.fn(),
    addSelected: vi.fn(),
    ...overrides,
  }
}

function registrationState(
  overrides: Partial<RegistrationState> = {}
): RegistrationState {
  return {
    feedUrl: "",
    pending: false,
    canSubmit: false,
    setFeedUrl: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  }
}

describe("AddFeedCardView", () => {
  it("adds the selected catalog feed", async () => {
    const addSelected = vi.fn()
    const user = userEvent.setup()

    render(
      <AddFeedCardView
        catalog={catalogState({
          selectedFeedId: "feed-1",
          canAdd: true,
          addSelected,
        })}
        registration={registrationState()}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "選択したフィードを追加" })
    )
    expect(addSelected).toHaveBeenCalledOnce()
  })

  it("submits a valid feed URL after switching to URL mode", async () => {
    const submit = vi.fn()
    const user = userEvent.setup()

    render(
      <AddFeedCardView
        catalog={catalogState()}
        registration={registrationState({
          feedUrl: "https://example.com/feed.xml",
          canSubmit: true,
          submit,
        })}
      />
    )

    await user.click(screen.getByRole("button", { name: "URLで追加" }))
    await user.click(screen.getByRole("button", { name: "URLから追加" }))

    expect(submit).toHaveBeenCalledOnce()
  })

  it("disables the URL field while registration is pending", async () => {
    const user = userEvent.setup()

    render(
      <AddFeedCardView
        catalog={catalogState()}
        registration={registrationState({
          feedUrl: "https://example.com/feed.xml",
          pending: true,
        })}
      />
    )

    await user.click(screen.getByRole("button", { name: "URLで追加" }))

    expect(
      (screen.getByLabelText("フィードURL") as HTMLInputElement).disabled
    ).toBe(true)
  })
})
