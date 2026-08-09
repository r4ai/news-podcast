import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { PodcastDashboard } from "@/features/dashboard/podcast-dashboard"

const meta = {
  title: "Foundation/Podcast dashboard",
  component: PodcastDashboard,
  args: {
    onGenerate: fn(),
    state: "ready",
  },
  parameters: {
    layout: "fullscreen",
  },
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
  args: { state: "running" },
}

export const Succeeded: Story = {
  args: { state: "succeeded" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const disclosure = canvas.getByText("出典を確認", { exact: true })
    await userEvent.click(disclosure)
    await expect(disclosure.parentElement).toHaveAttribute("open")
  },
}
