import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ScheduleFormView, type ScheduleFormViewProps } from "./schedule-form"

const timeZones = [
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "UTC", label: "UTC (UTC+0)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-7)" },
  { value: "Europe/London", label: "Europe/London (UTC+1)" },
] as const

function props(
  overrides: Partial<ScheduleFormViewProps> = {}
): ScheduleFormViewProps {
  return {
    draft: { enabled: true, localTime: "07:30", timeZone: "Asia/Tokyo" },
    saveState: "idle",
    timeZones,
    update: vi.fn(),
    saveNow: vi.fn(),
    ...overrides,
  }
}

function timeZoneField() {
  return screen.getByRole("combobox", { name: "タイムゾーン" })
}

/**
 * 空メッセージはCSSで出し分けられるが、jsdomはCSSを評価しない。
 * 出し分けの根拠になっているpopupの`data-empty`を直接確かめる。
 */
function timeZonePopupIsEmpty() {
  const popup = document.querySelector("[data-slot=combobox-content]")
  return popup !== null && popup.hasAttribute("data-empty")
}

describe("ScheduleFormView", () => {
  it("filters the time zone candidates by what was typed", async () => {
    const user = userEvent.setup()
    render(<ScheduleFormView {...props()} />)

    await user.click(timeZoneField())
    await user.keyboard("tokyo")

    expect(
      await screen.findByRole("option", { name: /Asia\/Tokyo/ })
    ).toBeDefined()
    expect(screen.queryByRole("option", { name: /Europe\/London/ })).toBeNull()
    expect(timeZonePopupIsEmpty()).toBe(false)
  })

  it("keeps every candidate selectable before anything is typed", async () => {
    const user = userEvent.setup()
    render(<ScheduleFormView {...props()} />)

    await user.click(timeZoneField())

    expect(await screen.findAllByRole("option")).toHaveLength(timeZones.length)
    expect(timeZonePopupIsEmpty()).toBe(false)
  })

  it("reports the picked time zone by its IANA name", async () => {
    const update = vi.fn()
    const user = userEvent.setup()
    render(<ScheduleFormView {...props({ update })} />)

    await user.click(timeZoneField())
    await user.keyboard("london")
    await user.click(await screen.findByRole("option", { name: /London/ }))

    expect(update).toHaveBeenCalledWith({ timeZone: "Europe/London" })
  })

  it("announces the empty state only when nothing matches", async () => {
    const user = userEvent.setup()
    render(<ScheduleFormView {...props()} />)

    await user.click(timeZoneField())
    await user.keyboard("zzzz")

    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(timeZonePopupIsEmpty()).toBe(true)
    expect(screen.getByText("一致するタイムゾーンがありません。")).toBeDefined()
  })

  it("locks both the time and the time zone while auto generation is off", () => {
    render(
      <ScheduleFormView
        {...props({
          draft: {
            enabled: false,
            localTime: "07:30",
            timeZone: "Asia/Tokyo",
          },
        })}
      />
    )

    expect((screen.getByLabelText("時刻") as HTMLInputElement).disabled).toBe(
      true
    )
    expect((timeZoneField() as HTMLInputElement).disabled).toBe(true)
  })

  it("renders the time as a plain input, without a decorated group", () => {
    render(<ScheduleFormView {...props()} />)

    const time = screen.getByLabelText("時刻")
    expect(time.getAttribute("type")).toBe("time")
    expect(time.getAttribute("data-slot")).toBe("input")
    expect(time.className).not.toMatch(/text-2xl/)
  })

  it("keeps the save status region mounted in every state", () => {
    for (const saveState of ["idle", "saving", "saved", "error"] as const) {
      const { unmount } = render(<ScheduleFormView {...props({ saveState })} />)
      expect(screen.getByRole("status", { name: "保存状態" })).toBeDefined()
      unmount()
    }
  })
})
