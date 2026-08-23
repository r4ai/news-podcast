import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

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

/** `navigator.onLine`は読み取り専用なので、記述子ごと差し替えて回線を模す。 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value })
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"))
  })
}

describe("回線が戻ったときのPanel", () => {
  afterEach(() => setOnline(true))

  it("切れている間に落ちたパネルは、戻った時点で自力で取り直す", async () => {
    const flaky = flakyQuery()
    const queryClient = createTestQueryClient()
    setOnline(false)

    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ["panel-offline"],
        queryFn: flaky.queryFn,
      })
      return <p>{data}</p>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Panel name="panel-offline">
          <Content />
        </Panel>
      </QueryClientProvider>
    )
    expect(
      await screen.findByText("この項目を表示できませんでした")
    ).toBeTruthy()

    setOnline(true)

    expect(await screen.findByText("ダッシュボード")).toBeTruthy()
    expect(flaky.attempts).toBe(2)
  })

  it("繋がったまま落ちたパネルは勝手に叩き直さない", async () => {
    const alwaysFails = {
      calls: 0,
      queryFn: async () => {
        alwaysFails.calls += 1
        throw new Error("サーバエラー")
      },
    }
    const queryClient = createTestQueryClient()

    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ["panel-server-error"],
        queryFn: alwaysFails.queryFn,
      })
      return <p>{String(data)}</p>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Panel name="panel-server-error">
          <Content />
        </Panel>
      </QueryClientProvider>
    )
    expect(
      await screen.findByText("この項目を表示できませんでした")
    ).toBeTruthy()

    // 繋がっている状態で`online`が届いても、失っていたものは無い。
    setOnline(true)

    expect(alwaysFails.calls).toBe(1)
  })
})
