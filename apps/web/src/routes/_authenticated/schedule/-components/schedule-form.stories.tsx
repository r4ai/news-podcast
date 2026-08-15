import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { ScheduleFormView } from "./schedule-form"

const meta = {
  title: "Schedule/Schedule form",
  component: ScheduleFormView,
  args: {
    draft: { enabled: true, localTime: "07:30", timeZone: "Asia/Tokyo" },
    saveState: "idle",
    timeZones: [
      { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
      { value: "UTC", label: "UTC (UTC+0)" },
      { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-7)" },
      { value: "Europe/London", label: "Europe/London (UTC+1)" },
    ],
    update: fn(),
    saveNow: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ScheduleFormView>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Disabled: Story = {
  args: { draft: { enabled: false, localTime: "07:30", timeZone: "Asia/Tokyo" } },
}

export const Saving: Story = {
  args: { saveState: "saving" },
}

export const Saved: Story = {
  args: { saveState: "saved" },
}

export const Error: Story = {
  args: {
    saveState: "error",
    error: "時刻とタイムゾーンを確認してください。",
  },
}
