import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { PodcastDashboard } from "./podcast-dashboard"

describe("PodcastDashboard の完成Episode投影", () => {
  it("job完了後の投影待ちを完成とは区別する", () => {
    render(<PodcastDashboard state="projecting" />)

    expect(screen.getByText("完成した番組を準備しています")).toBeDefined()
    expect(screen.getByRole("button", { name: "番組を準備中…" })).toBeDefined()
    expect(screen.queryByText("今日の番組が完成しました")).toBeNull()
  })

  it("期限超過を通知し、対象Episodeの再確認を実行できる", async () => {
    const user = userEvent.setup()
    const onRetryProjection = vi.fn()
    render(
      <PodcastDashboard
        onRetryProjection={onRetryProjection}
        state="projection-failed"
      />
    )

    expect(screen.getByText("完成した番組を確認できませんでした")).toBeDefined()
    await user.click(screen.getByRole("button", { name: "番組を再確認" }))
    expect(onRetryProjection).toHaveBeenCalledOnce()
  })
})
