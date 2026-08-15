import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { createTestQueryClient } from "@/shared/test/render"
import { Panel } from "./panel"

/** 1回目だけ失敗し、2回目以降は成功するqueryFn。 */
function flakyQuery() {
  let attempts = 0
  return {
    get attempts() {
      return attempts
    },
    queryFn: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("取得に失敗しました")
      return "ダッシュボード"
    },
  }
}

describe("Panel", () => {
  it("再試行でqueryを取り直し、パネルの中身を表示する", async () => {
    const flaky = flakyQuery()
    const queryClient = createTestQueryClient()
    const user = userEvent.setup()

    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ["panel-test"],
        queryFn: flaky.queryFn,
      })
      return <p>{data}</p>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Panel name="panel-test">
          <Content />
        </Panel>
      </QueryClientProvider>
    )

    expect(
      await screen.findByText("この項目を表示できませんでした")
    ).toBeTruthy()
    expect(flaky.attempts).toBe(1)

    await user.click(screen.getByRole("button", { name: "再試行" }))

    // React側の境界だけをresetしてもQueryのerror stateが残るため、
    // QueryErrorResetBoundaryと繋がっていなければここで同じエラーが再送出される。
    expect(await screen.findByText("ダッシュボード")).toBeTruthy()
    expect(flaky.attempts).toBe(2)
  })

  it("読み込み中はfallbackを表示する", async () => {
    const queryClient = createTestQueryClient()

    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ["panel-test-loading"],
        queryFn: () => Promise.resolve("完了"),
      })
      return <p>{data}</p>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Panel fallback={<p>読み込み中</p>} name="panel-test-loading">
          <Content />
        </Panel>
      </QueryClientProvider>
    )

    expect(screen.getByText("読み込み中")).toBeTruthy()
    expect(await screen.findByText("完了")).toBeTruthy()
  })
})
