import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import {
  AiEnrichPanelView,
  type AiEnrichPanelViewProps,
} from "./ai-enrich-panel"

function args(
  overrides: Partial<AiEnrichPanelViewProps>
): AiEnrichPanelViewProps {
  return {
    daily: { used: 12, limit: 200 },
    reprocessableCount: 321,
    pending: false,
    confirmOpen: false,
    requestReprocess: fn(),
    cancelReprocess: fn(),
    confirmReprocess: fn(),
    resetDaily: fn(),
    ...overrides,
  }
}

const meta = {
  title: "Settings/AI enrichment panel",
  component: AiEnrichPanelView,
  args: args({}),
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-lg p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof AiEnrichPanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const DailyLimitReached: Story = {
  args: args({ daily: { used: 200, limit: 200 } }),
}

export const NothingToReprocess: Story = {
  args: args({ reprocessableCount: 0 }),
}

export const ConfirmOpen: Story = {
  args: args({ confirmOpen: true }),
}

export const Submitting: Story = {
  args: args({ pending: true }),
}
