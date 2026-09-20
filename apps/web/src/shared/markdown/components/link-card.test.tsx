import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LinkCard } from "./link-card"

describe("LinkCard", () => {
  it("shows title, description, thumbnail and an accessible destination", () => {
    const { getByRole, container } = render(
      <LinkCard
        data-embed-url="https://example.com/article"
        data-card-title="Article title"
        data-card-description="Description"
        data-card-image="https://example.com/og.png"
      />
    )
    expect(getByRole("link").textContent).toContain("Article title")
    expect(getByRole("link").getAttribute("href")).toBe(
      "https://example.com/article"
    )
    const img = container.querySelector("img:not([data-card-favicon])")!
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer")
    fireEvent.error(img)
    expect(container.querySelector("img:not([data-card-favicon])")).toBeNull()
    expect(getByRole("link").textContent).toContain("Article title")
  })
  it("keeps missing or unsafe metadata usable", () => {
    const { container } = render(
      <LinkCard
        data-embed-url="https://example.com/path"
        data-card-image="javascript:alert(1)"
      />
    )
    expect(container.textContent).toContain("example.com")
    expect(container.querySelector("img:not([data-card-favicon])")).toBeNull()
  })
  it("drops unsafe destinations", () => {
    expect(
      render(<LinkCard data-embed-url="javascript:x" />).container.textContent
    ).toBe("")
  })
})

it("renders the favicon and falls back after a loading error", () => {
  const { container } = render(
    <LinkCard
      data-embed-url="https://example.com/article"
      data-card-favicon="https://example.com/icon.svg"
    />
  )
  const icon = container.querySelector("img[data-card-favicon]")!
  expect(icon).not.toBeNull()
  expect(icon.getAttribute("src")).toBe("https://example.com/icon.svg")
  fireEvent.error(icon)
  expect(container.querySelector("img[data-card-favicon]")).toBeNull()
  expect(container.textContent).toContain("example.com")
})
