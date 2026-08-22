import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { EpisodeJobAgUiEvent } from "@news-podcast/contracts/agui"

import {
  TestProviders,
  createTestQueryClient,
  stubFetch,
} from "@/shared/test/render"
import { StubRouterProvider } from "@/shared/test/stub-router"
import {
  renderCount,
  resetRenderCounts,
  waitForRenderQuiescence,
} from "@/shared/test/render-count"

/**
 * 生成中のSSEは数分にわたって毎秒フレームを送る。1フレームで描き直る範囲が
 * そのまま無駄な仕事の量になるので、ここで数字にして固定する (ADR-0060)。
 */

const stream = vi.hoisted(() => ({
  onFrame: undefined as
    | ((frame: { id?: string; data: string }) => void)
    | undefined,
}))

vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api")>()
  return {
    ...actual,
    // 繋がったまま返さないpromise。呼び出し側の`finally`が走らないので、
    // テストの間ずっと「接続中」でいられる。
    subscribeEventStream: vi.fn(
      (
        _url: string,
        options: {
          onOpen?: () => void
          onFrame: (frame: { id?: string; data: string }) => void
        }
      ) => {
        stream.onFrame = options.onFrame
        options.onOpen?.()
        return new Promise<void>(() => {})
      }
    ),
  }
})

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// 実物をそのまま包んで数える。JSXのtypeは安定するので、親のメモ化による
// bailoutは包む前と同じように効く。
vi.mock("./podcast-dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./podcast-dashboard")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    PodcastDashboard: watchRenders("PodcastDashboard", actual.PodcastDashboard),
  }
})
vi.mock("./generation-timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./generation-timeline")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    GenerationTimeline: watchRenders(
      "GenerationTimeline",
      actual.GenerationTimeline
    ),
  }
})

const { GenerationDashboard } = await import("./generation-dashboard")

const runningJob = {
  id: "job-1",
  status: "running",
  stage: "selecting_articles",
  attempt: 1,
  maxAttempts: 4,
  articleIds: [],
  deadlineAt: null,
  lastProgressAt: null,
  nextAttemptAt: null,
  stageProgress: null,
  failure: null,
}

const snapshot = {
  jobId: "job-1",
  status: "running" as const,
  attempt: 1,
  maxAttempts: 4 as const,
  selectionMode: "automatic" as const,
  selectedArticles: [],
}

// 進行中の状態通知。段階まで含めて`STEP_STARTED`の後と同じ内容なので、
// これが届いても画面に出る値は1つも変わらない。
const runningSnapshot = {
  ...snapshot,
  currentStage: "selecting_articles" as const,
}

const SUBSCRIPTIONS_KEY = ["get", "/v1/me/feed-subscriptions"] as const

function routes() {
  return [
    { path: "/v1/episode-jobs", body: { items: [runningJob] } },
    { path: "/v1/episodes", body: { items: [] } },
    {
      path: "/v1/me/settings",
      body: {
        generationSchedule: {
          enabled: true,
          localTime: "07:00",
          timeZone: "Asia/Tokyo",
        },
        interestProfile: { text: "" },
        aiEnrich: { enabled: false },
      },
    },
    {
      path: "/v1/me/feed-subscriptions",
      body: { items: [{ id: "sub-1", feedId: "feed-1", enabled: true }] },
    },
    {
      path: "/v1/feeds",
      body: {
        items: [{ id: "feed-1", name: "Zenn", url: "https://zenn.dev" }],
      },
    },
  ]
}

/** SSEフレームを1件流す。 */
async function push(event: EpisodeJobAgUiEvent, id: number) {
  await act(async () => {
    stream.onFrame?.({ id: String(id), data: JSON.stringify(event) })
  })
}

async function renderDashboard() {
  stubFetch(routes())
  const queryClient = createTestQueryClient()
  render(
    <TestProviders queryClient={queryClient}>
      {/* カード内の遷移リンクが`<Link>`なので、routerの中で立ち上げる。 */}
      <StubRouterProvider>
        <GenerationDashboard />
      </StubRouterProvider>
    </TestProviders>
  )
  await waitFor(() => expect(screen.getByText("生成ステータス")).toBeDefined())
  await waitFor(() => expect(stream.onFrame).toBeDefined())
  return queryClient
}

describe("生成ダッシュボードの描画範囲", () => {
  beforeEach(() => {
    resetRenderCounts()
    stream.onFrame = undefined
  })

  /**
   * 作業実況が1段進むのは、進捗カードの中の話。状態も段階も変わっていない
   * フレームで、購読フィードや最新エピソードまで描き直す理由はない。
   */
  it("タイムラインだけが動くフレームでダッシュボードを描き直さない", async () => {
    await renderDashboard()

    await push({ type: "STATE_SNAPSHOT", snapshot: runningSnapshot }, 1)
    await push({ type: "STEP_STARTED", stepName: "selecting_articles" }, 2)
    await waitForRenderQuiescence(waitFor, "GenerationTimeline")

    const dashboardBefore = renderCount("PodcastDashboard")
    const timelineBefore = renderCount("GenerationTimeline")

    // 段階の完了と、中身の変わらない状態通知。どちらも進捗カードの外には
    // 影響しない。
    await push({ type: "STEP_FINISHED", stepName: "selecting_articles" }, 3)
    await push({ type: "STATE_SNAPSHOT", snapshot: runningSnapshot }, 4)
    await push({ type: "STATE_SNAPSHOT", snapshot: runningSnapshot }, 5)

    const dashboardRenders = renderCount("PodcastDashboard") - dashboardBefore
    const timelineRenders = renderCount("GenerationTimeline") - timelineBefore

    expect(
      dashboardRenders,
      `3フレームでダッシュボードが${dashboardRenders}回描き直された`
    ).toBe(0)
    // 実況そのものは動く。動かないことを確かめているのではない。
    expect(timelineRenders).toBeGreaterThan(0)
  })

  /**
   * 購読フィードは左のサイドバーにしか出ない。生成の進捗とは無関係なので、
   * 片方の更新でもう片方を描き直さない。
   */
  it("購読フィードの更新でダッシュボードを描き直さない", async () => {
    const queryClient = await renderDashboard()
    await waitForRenderQuiescence(waitFor, "PodcastDashboard")
    const before = renderCount("PodcastDashboard")

    await act(async () => {
      queryClient.setQueriesData(
        { queryKey: SUBSCRIPTIONS_KEY },
        { items: [{ id: "sub-1", feedId: "feed-1", enabled: false }] }
      )
    })
    await waitFor(() => {})

    const after = renderCount("PodcastDashboard") - before
    expect(
      after,
      `購読フィードの更新だけでダッシュボードが${after}回描き直された`
    ).toBe(0)
  })
})
