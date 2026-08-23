import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { StubRouterProvider } from "@/shared/test/stub-router"
import { GenerationSettingsSummary } from "./generation-settings-summary"
import { PodcastDashboard } from "./podcast-dashboard"

const meta = {
  title: "Foundation/Podcast dashboard",
  component: PodcastDashboard,
  args: {
    onGenerate: fn(),
    state: "ready",
    // 実画面ではSSEと3つのqueryを購読する差し込み。ここは値を固定して渡す。
    settingsSlot: (
      <GenerationSettingsSummary
        schedule={{
          enabled: true,
          localTime: "07:30",
          timeZone: "Asia/Tokyo",
        }}
        subscriptionNames={["Zenn", "azukiazusaの技術ブログ", "Hacker News"]}
      />
    ),
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    // カード内の遷移リンクは`<Link>`。routerが無いと組み立てられない。
    (Story) => (
      <StubRouterProvider>
        <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
          <Story />
        </main>
      </StubRouterProvider>
    ),
  ],
} satisfies Meta<typeof PodcastDashboard>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "番組を生成" }))
    await expect(args.onGenerate).toHaveBeenCalledOnce()
  },
}

export const Running: Story = {
  args: { progress: 75, stage: "音声を生成中", state: "running" },
}

export const Succeeded: Story = {
  args: {
    episode: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "今日のテックニュース",
      createdAt: "2026-08-09T07:30:00.000Z",
      sourceCount: 3,
    },
    state: "succeeded",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText("今日のテックニュース", { exact: true })
    ).toBeVisible()
  },
}
