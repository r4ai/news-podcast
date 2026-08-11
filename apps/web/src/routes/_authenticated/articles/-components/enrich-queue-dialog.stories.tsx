import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import type { EnrichQueueStatus } from "@/features/enrich/queue"
import {
  EnrichQueueDialog,
  type EnrichQueueDialogProps,
} from "./enrich-queue-dialog"

function item(overrides: Partial<EnrichQueueStatus["recent"][number]> = {}) {
  return {
    feedItemId: "feed-item-1",
    title: "OpenTelemetryでWebフロントの分散traceを組む",
    sourceName: "Hacker News",
    priority: 0,
    reason: "new" as const,
    status: "succeeded" as const,
    attempt: 0,
    createdAt: "2026-08-11T08:00:00.000Z",
    ...overrides,
  }
}

const status: EnrichQueueStatus = {
  processing: [
    item({
      feedItemId: "proc-1",
      title: "React 19の並行機能をSuspenseで使い倒す",
      status: "processing",
      startedAt: "2026-08-11T08:00:00.000Z",
    }),
  ],
  pending: {
    count: 3,
    items: [
      item({
        feedItemId: "pending-1",
        title: "SQLiteのFTS5で全文検索を高速化する",
        status: "queued",
      }),
      item({
        feedItemId: "pending-2",
        title: "VOICEVOXの新モデルを試す",
        status: "queued",
      }),
    ],
  },
  failed: {
    count: 1,
    items: [
      item({
        feedItemId: "failed-1",
        title: "429で失敗した記事",
        status: "failed",
        attempt: 4,
        error: "OpenAI request was rate limited",
        completedAt: "2026-08-11T08:10:00.000Z",
      }),
    ],
  },
  recent: [
    item({
      feedItemId: "r1",
      title: "成功した記事",
      status: "succeeded",
      completedAt: "2026-08-11T08:05:00.000Z",
    }),
    item({
      feedItemId: "r2",
      title: "失敗した記事",
      status: "failed",
      attempt: 1,
      error: "boom",
      completedAt: "2026-08-11T08:06:00.000Z",
    }),
  ],
  daily: { used: 42, limit: 200 },
  reprocessable: { count: 321 },
}

function args(
  overrides: Partial<EnrichQueueDialogProps>
): EnrichQueueDialogProps {
  return {
    open: true,
    onOpenChange: fn(),
    status,
    connected: true,
    ...overrides,
  }
}

const meta = {
  title: "Articles/Enrich queue dialog",
  component: EnrichQueueDialog,
  args: args({}),
  parameters: { layout: "centered" },
} satisfies Meta<typeof EnrichQueueDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Live: Story = {}

export const PollingFallback: Story = {
  args: args({ connected: false }),
}

export const Empty: Story = {
  args: args({
    status: {
      processing: [],
      pending: { count: 0, items: [] },
      failed: { count: 0, items: [] },
      recent: [],
      daily: { used: 0, limit: 200 },
      reprocessable: { count: 0 },
    },
  }),
}

export const DailyLimitReached: Story = {
  args: args({
    status: { ...status, daily: { used: 200, limit: 200 } },
  }),
}
