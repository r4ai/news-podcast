import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"
import { MarkdownToc } from "./markdown-toc"

const outline = (
  ...entries: readonly (readonly [string, number])[]
): readonly HeadingOutlineEntry[] =>
  entries.map(([text, level]) => ({ id: text, level, text }))

describe("MarkdownToc", () => {
  it("indents by depth relative to the shallowest heading, not by absolute level", () => {
    // リーダーは見出しをh3から始めるので、絶対レベルで字下げすると全部が
    // 深い位置になる。
    const { container } = render(
      <MarkdownToc outline={outline(["章", 3], ["節", 4])} />
    )

    const items = Array.from(container.querySelectorAll("li"))
    expect(items[0]?.className).toContain("pl-0")
    expect(items[1]?.className).toContain("pl-3")
  })

  it("omits headings deeper than two levels so the toc stays scannable", () => {
    render(<MarkdownToc outline={outline(["章", 3], ["節", 4], ["項", 5])} />)

    expect(screen.queryByRole("link", { name: "項" })).toBeNull()
    expect(screen.getByRole("link", { name: "節" })).toBeTruthy()
  })

  it("renders nothing when there is not enough structure to navigate", () => {
    const { container } = render(<MarkdownToc outline={outline(["章", 3])} />)

    expect(container.firstChild).toBeNull()
  })

  it("marks the active heading as the current location", () => {
    render(
      <MarkdownToc activeId="節" outline={outline(["章", 3], ["節", 3])} />
    )

    expect(
      screen.getByRole("link", { name: "節" }).getAttribute("aria-current")
    ).toBe("location")
    expect(
      screen.getByRole("link", { name: "章" }).getAttribute("aria-current")
    ).toBeNull()
  })

  it("escapes ids so a japanese heading produces a usable fragment", () => {
    render(
      <MarkdownToc outline={outline(["設計を中心とした開発", 3], ["節", 3])} />
    )

    expect(
      screen
        .getByRole("link", { name: "設計を中心とした開発" })
        .getAttribute("href")
    ).toBe(`#${encodeURIComponent("設計を中心とした開発")}`)
  })
})
