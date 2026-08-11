import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { EnrichQueueStatus } from "@/features/enrich/queue"
import { EnrichQueueDialog } from "./enrich-queue-dialog"

const status = {
  processing: [],
  pending: {
    count: 2,
    items: [
      {
        feedItemId: "article-1",
        title: "待っている記事",
        sourceName: "Zenn",
        priority: 1,
        reason: "new",
        status: "queued",
        attempt: 0,
        createdAt: "2026-08-12T00:00:00.000Z",
      },
    ],
  },
  failed: { count: 0, items: [] },
  recent: [],
  daily: { used: 100, limit: 100 },
  reprocessable: { count: 0 },
} satisfies EnrichQueueStatus

describe("EnrichQueueDialog", () => {
  it("labels queued work as limit waiting instead of processing at the daily cap", () => {
    render(
      <EnrichQueueDialog
        connected
        onOpenChange={vi.fn()}
        open
        status={status}
      />
    )

    expect(screen.getByText("本日の上限待ち 2件")).toBeTruthy()
    expect(screen.getByText("上限待ち")).toBeTruthy()
    expect(screen.queryByText("処理中")).toBeNull()
  })
})
