import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import type { Feed, FeedSyncJob, Subscription } from "@/features/subscriptions"
import { SubscriptionListView } from "./subscription-list"

const feeds = [
  { id: "feed-1", name: "Zenn" },
  { id: "feed-2", name: "Hacker News" },
] as unknown as Feed[]

const subscriptions = [
  { id: "sub-1", feedId: "feed-1", enabled: true },
  { id: "sub-2", feedId: "feed-2", enabled: false },
] as unknown as Subscription[]

const meta = {
  title: "Subscriptions/Subscription list",
  component: SubscriptionListView,
  args: {
    feeds,
    subscriptions,
    jobs: [],
    pending: false,
    onToggle: fn(),
    onRemove: fn(),
    onSync: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof SubscriptionListView>

export default meta
type Story = StoryObj<typeof meta>

export const WithSubscriptions: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("switch", { name: "Zennを生成対象にする" })
    )
    await expect(args.onToggle).toHaveBeenCalledOnce()
  },
}

export const UnknownFeedFallsBackToId: Story = {
  args: {
    subscriptions: [
      { id: "sub-3", feedId: "feed-missing", enabled: true },
    ] as unknown as Subscription[],
  },
}

export const Empty: Story = {
  args: { subscriptions: [] },
}

export const Pending: Story = {
  args: { pending: true },
}

export const Syncing: Story = {
  args: {
    jobs: [
      {
        jobId: "job-1",
        feedId: "feed-1",
        feedUrl: "https://zenn.dev/feed",
        status: "processing",
        attempt: 1,
        maxAttempts: 4,
        discovered: 3,
        archived: 1,
        failed: 0,
        createdAt: "2026-08-15T00:00:00.000Z",
      },
    ] as unknown as FeedSyncJob[],
  },
}

export const SyncFailed: Story = {
  args: {
    jobs: [
      {
        jobId: "job-2",
        feedId: "feed-2",
        feedUrl: "https://news.ycombinator.com/rss",
        status: "failed",
        attempt: 4,
        maxAttempts: 4,
        discovered: 0,
        archived: 0,
        failed: 1,
        createdAt: "2026-08-15T00:00:00.000Z",
        error: "HttpStatus",
      },
    ] as unknown as FeedSyncJob[],
  },
}
