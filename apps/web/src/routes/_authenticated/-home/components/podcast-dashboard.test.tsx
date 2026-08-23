import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { renderWithStubRouter } from "@/shared/test/render"
import { failureMessage, failureRecovery } from "../model"
import { PodcastDashboard } from "./podcast-dashboard"

describe("PodcastDashboard の完成Episode投影", () => {
  it.each([
    ["retrying", "日次予約: 再調整中"],
    ["succeeded", "日次予約: 完了"],
    ["missed", "日次予約: 未達"],
  ] as const)(
    "日次予約の %s を区別して表示する",
    async (scheduleStatus, label) => {
      renderWithStubRouter(<PodcastDashboard scheduleStatus={scheduleStatus} />)

      expect(await screen.findByText(label)).toBeDefined()
    }
  )

  it("job完了後の投影待ちを完成とは区別する", async () => {
    renderWithStubRouter(<PodcastDashboard state="projecting" />)

    expect(
      await screen.findByText("完成した番組を準備しています")
    ).toBeDefined()
    expect(screen.getByRole("button", { name: "番組を準備中…" })).toBeDefined()
    expect(screen.queryByText("今日の番組が完成しました")).toBeNull()
  })

  it("期限超過を通知し、対象Episodeの再確認を実行できる", async () => {
    const user = userEvent.setup()
    const onRetryProjection = vi.fn()
    renderWithStubRouter(
      <PodcastDashboard
        onRetryProjection={onRetryProjection}
        state="projection-failed"
      />
    )

    expect(
      await screen.findByText("完成した番組を確認できませんでした")
    ).toBeDefined()
    await user.click(screen.getByRole("button", { name: "番組を再確認" }))
    expect(onRetryProjection).toHaveBeenCalledOnce()
  })
})

describe("PodcastDashboard の生成失敗", () => {
  it.each([
    [
      "job_deadline_exceeded",
      "生成が制限時間を超えました。同じ条件で再試行してください。",
      "同じ条件で再試行",
    ],
    [
      "script_timeout",
      "台本生成サービスが時間内に応答しませんでした。同じ条件で再試行してください。",
      "同じ条件で再試行",
    ],
    [
      "speech_unavailable",
      "音声生成サービスを一時的に利用できません。同じ条件で再試行してください。",
      "同じ条件で再試行",
    ],
    [
      "content_materialization_invalid",
      "生成条件を確認できませんでした。記事を選び直してください。",
      "記事を選び直して再生成",
    ],
    [
      "no_generation_candidates",
      "番組にできる新しい記事がありません。記事を選んで生成してください。",
      "記事を選び直して再生成",
    ],
    [
      "sqlite_decode_checkpoint_corrupt_record",
      "保存済みデータを安全に処理できませんでした。問い合わせIDを添えて管理者へ連絡してください。",
      "新規生成",
    ],
    [
      "audio_store_unavailable",
      "番組を保存できませんでした。時間をおいて再試行してください。",
      "同じ条件で再試行",
    ],
  ] as const)(
    "renders %s with guidance and action",
    async (code, message, action) => {
      const recovery = failureRecovery(code)
      const retryLabel =
        recovery === "reselect"
          ? "記事を選び直して再生成"
          : recovery === "retry"
            ? "同じ条件で再試行"
            : "新規生成"
      renderWithStubRouter(
        <PodcastDashboard
          failure={failureMessage({ code, message: code })}
          onRetry={() => {}}
          retryLabel={retryLabel}
          state="failed"
        />
      )

      expect(await screen.findByText(message)).toBeDefined()
      expect(screen.getByRole("button", { name: action })).toBeDefined()
    }
  )
})

describe("PodcastDashboard の画面遷移", () => {
  it("「すべて見る」はページを読み込み直さずライブラリへ移る", async () => {
    const user = userEvent.setup()
    const { router } = renderWithStubRouter(<PodcastDashboard state="ready" />)

    await user.click(await screen.findByRole("link", { name: "すべて見る" }))

    expect(router.state.location.pathname).toBe("/library")
  })
})
