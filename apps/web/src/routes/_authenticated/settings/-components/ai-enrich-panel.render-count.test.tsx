import { act, render, screen, waitFor } from "@testing-library/react"
import type { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ENRICH_QUEUE_QUERY_KEY } from "@/features/enrich/queue"
import {
  TestProviders,
  createTestQueryClient,
  stubFetch,
} from "@/shared/test/render"
import {
  renderCount,
  resetRenderCounts,
  waitForRenderQuiescence,
} from "@/shared/test/render-count"
import { AiEnrichPanel } from "./ai-enrich-panel"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// パネル本体を実物のまま包んで数える。
vi.mock("./settings-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings-section")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    SettingsSection: watchRenders("AiEnrichSection", actual.SettingsSection),
  }
})

function queueItem(id: string) {
  return {
    feedItemId: id,
    title: `記事 ${id}`,
    sourceName: "Zenn",
    priority: 0,
    reason: "new" as const,
    status: "queued" as const,
    attempt: 0,
    createdAt: "2026-08-16T00:00:00.000Z",
  }
}

function queueStatus(recentIds: readonly string[], used = 34) {
  return {
    processing: [],
    pending: { count: 0, items: [] },
    failed: { count: 0, items: [] },
    recent: recentIds.map(queueItem),
    daily: { used, limit: 200 },
    reprocessable: { count: 3 },
  }
}

/**
 * 取り直しと同じ形でスナップショットを差し替え、cacheへ書き終わるまで待つ。
 * 書き込み自体は同期でも、observerへの通知はmicrotask経由なので、
 * 「描き直されなかった」を主張する前にここまで進めておく必要がある。
 */
async function replaceQueueSnapshot(
  queryClient: QueryClient,
  next: ReturnType<typeof queueStatus>
) {
  const before = queryClient.getQueryState(
    ENRICH_QUEUE_QUERY_KEY
  )?.dataUpdatedAt
  await act(async () => {
    queryClient.setQueryData(ENRICH_QUEUE_QUERY_KEY, next)
  })
  await waitFor(() =>
    expect(
      queryClient.getQueryState(ENRICH_QUEUE_QUERY_KEY)?.dataUpdatedAt
    ).not.toBe(before)
  )
}

async function renderPanel() {
  const queryClient = createTestQueryClient()
  stubFetch([{ path: "/v1/me/enrich/queue", body: queueStatus(["a"]) }])
  render(
    <TestProviders queryClient={queryClient}>
      <AiEnrichPanel />
    </TestProviders>
  )
  await waitFor(() => expect(screen.getByText("34 / 200回")).toBeDefined())
  await waitForRenderQuiescence(waitFor, "AiEnrichSection")
  return { queryClient, settled: renderCount("AiEnrichSection") }
}

describe("AI処理パネルの描画範囲", () => {
  beforeEach(() => resetRenderCounts())

  /**
   * このパネルは30秒ごとにキュー状態を取り直す。応答にはキューの明細まで
   * 入っているので、処理が進むだけで応答は毎回別物になる。描いているのは
   * 日次使用量と再処理可能件数だけなので、そこが動いていない取り直しでは
   * 1回も描き直さないのが正しい (hookの`select`が担保する)。
   */
  it("使用量が変わらない取り直しでは描き直さない", async () => {
    const { queryClient, settled } = await renderPanel()

    await replaceQueueSnapshot(queryClient, queueStatus(["b", "c", "d"]))
    await waitForRenderQuiescence(waitFor, "AiEnrichSection")

    const renders = renderCount("AiEnrichSection") - settled
    expect(
      renders,
      `明細だけが動いた取り直しでパネルが${renders}回描き直された`
    ).toBe(0)
  })

  /** 逆に、描いている値が動いたときは必ず追従する。 */
  it("使用量が動いたときは描き直す", async () => {
    const { queryClient, settled } = await renderPanel()

    await replaceQueueSnapshot(queryClient, queueStatus(["a"], 35))

    await waitFor(() => expect(screen.getByText("35 / 200回")).toBeDefined())
    expect(renderCount("AiEnrichSection")).toBeGreaterThan(settled)
  })
})
