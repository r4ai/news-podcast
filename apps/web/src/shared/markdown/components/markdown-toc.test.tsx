import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

    // 字下げは項目ではなくリンクが持つ。深い方が必ず内側へ入る。
    const links = Array.from(container.querySelectorAll("a"))
    expect(links[0]?.className).toContain("pl-1.5")
    expect(links[1]?.className).toContain("pl-3")
  })

  it("marks depth with a per-item marker instead of one continuous rule", () => {
    // 通しの罫は、どの項目がどの節に属するかを示さないまま丈だけ伸ばす。
    const { container } = render(
      <MarkdownToc outline={outline(["章", 3], ["節", 4])} />
    )

    const list = container.querySelector("ol")
    expect(list?.className).not.toContain("border-l")
    const markers = Array.from(container.querySelectorAll("a > [aria-hidden]"))
    expect(markers).toHaveLength(2)
    // 上位は点、下位はそれ自体では立たない短い線。同じ形だと重みが揃う。
    expect(markers[0]?.className).toContain("w-1.5")
    expect(markers[1]?.className).toContain("h-px")
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

  it("keeps the list open by default so the rail reads as a table of contents", () => {
    render(<MarkdownToc outline={outline(["章", 3], ["節", 3])} />)

    expect(
      screen.getByRole("button", { name: /目次/ }).getAttribute("aria-expanded")
    ).toBe("true")
    expect(screen.getByRole("link", { name: "章" })).toBeTruthy()
  })

  it("starts collapsed when the caller asks for it", () => {
    render(
      <MarkdownToc
        defaultOpen={false}
        outline={outline(["章", 3], ["節", 3])}
      />
    )

    expect(
      screen.getByRole("button", { name: /目次/ }).getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("opens and closes from the trigger", async () => {
    const user = userEvent.setup()
    render(
      <MarkdownToc
        defaultOpen={false}
        outline={outline(["章", 3], ["節", 3])}
      />
    )
    const trigger = screen.getByRole("button", { name: /目次/ })

    await user.click(trigger)
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
    )
    expect(screen.getByRole("link", { name: "章" })).toBeTruthy()

    await user.click(trigger)
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    )
  })

  it("counts the entries so the trigger says how long the article is", () => {
    render(<MarkdownToc outline={outline(["章", 3], ["節", 3], ["項", 3])} />)

    expect(screen.getByRole("button", { name: /目次/ }).textContent).toContain(
      "3"
    )
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
