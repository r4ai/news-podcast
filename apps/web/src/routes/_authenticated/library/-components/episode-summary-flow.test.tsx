import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { expect, it, vi } from "vitest"

import { currentEpisodeIdAtom } from "@/features/player"
import { attachAudioElementAtom } from "@/features/player/atoms"
import { Panel } from "@/shared/components/panel"
import {
  createTestQueryClient,
  createTestStore,
  TestProviders,
} from "@/shared/test/render"
import { EpisodeDetail, EpisodeDetailSkeleton } from "./episode-detail"
import { EpisodeList } from "./episode-list"

const summary = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "軽い一覧",
  createdAt: "2026-09-20T00:00:00.000Z",
}
const detail = {
  ...summary,
  script: "開いた時だけ読む台本",
  sources: [{ url: "https://example.com/", title: "出典" }],
}

function Library() {
  const [selected, select] = useState<string>()
  return (
    <>
      <EpisodeList onSelect={select} selectedEpisodeId={selected} />
      <Panel name="episode-detail" fallback={<EpisodeDetailSkeleton />}>
        {selected ? (
          <EpisodeDetail
            episodeId={selected}
            onBack={() => select(undefined)}
          />
        ) : null}
      </Panel>
    </>
  )
}

it("summary alone lists and plays; opening detail loads, fails and retries independently", async () => {
  const calls: string[] = []
  let resolveDetail!: (response: Response) => void
  let detailAttempt = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        "http://web.test"
      ).pathname
      calls.push(path)
      if (path === "/v1/episodes")
        return Response.json({ items: [summary], page: { hasMore: false } })
      if (path === `/v1/episodes/${summary.id}`) {
        detailAttempt++
        if (detailAttempt === 1)
          return new Promise<Response>((resolve) => {
            resolveDetail = resolve
          })
        return Response.json(detail)
      }
      throw new Error(`Unexpected fetch ${path}`)
    })
  )
  const client = createTestQueryClient()
  const store = createTestStore(client)
  const audio = {
    src: "",
    currentTime: 0,
    duration: 100,
    paused: true,
    playbackRate: 1,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  }
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)
  render(
    <TestProviders queryClient={client} store={store}>
      <Library />
    </TestProviders>
  )
  const user = userEvent.setup()
  await screen.findByText(summary.title)
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every((path) => path === "/v1/episodes")).toBe(true)
  await user.click(
    screen.getByRole("button", { name: `${summary.title}を再生` })
  )
  expect(store.get(currentEpisodeIdAtom)).toBe(summary.id)
  expect(audio.play).toHaveBeenCalled()
  expect(calls.every((path) => path === "/v1/episodes")).toBe(true)
  const listRequests = calls.length
  await user.click(screen.getByText(summary.title))
  await screen.findByRole("status", { name: "番組を読み込み中" })
  await waitFor(() => expect(detailAttempt).toBe(1))
  resolveDetail(Response.json({ title: "unavailable" }, { status: 503 }))
  await screen.findByText("この項目を表示できませんでした")
  expect(screen.getByText(summary.title)).toBeDefined()
  await user.click(screen.getByRole("button", { name: "再試行" }))
  await screen.findByText(detail.script)
  expect(detailAttempt).toBe(2)
  expect(calls.filter((path) => path === "/v1/episodes")).toHaveLength(
    listRequests
  )
})
