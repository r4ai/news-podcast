import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { RegisterFeedCardView } from "./register-feed-card"

describe("RegisterFeedCardView", () => {
  it("submits a valid feed URL with Enter", async () => {
    const submit = vi.fn()
    const user = userEvent.setup()

    render(
      <RegisterFeedCardView
        canSubmit
        feedUrl="https://example.com/feed.xml"
        pending={false}
        setFeedUrl={vi.fn()}
        submit={submit}
      />
    )

    await user.click(screen.getByLabelText("フィードURL"))
    await user.keyboard("{Enter}")

    expect(submit).toHaveBeenCalledOnce()
  })

  it("disables the URL field while registration is pending", () => {
    render(
      <RegisterFeedCardView
        canSubmit={false}
        feedUrl="https://example.com/feed.xml"
        pending
        setFeedUrl={vi.fn()}
        submit={vi.fn()}
      />
    )

    expect(
      (screen.getByLabelText("フィードURL") as HTMLInputElement).disabled
    ).toBe(true)
  })
})
