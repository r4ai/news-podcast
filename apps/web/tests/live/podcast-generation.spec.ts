import { EventSchemas } from "@ag-ui/core"
import { expect, test } from "@playwright/test"

type JobReceipt = { readonly id: string }
type JobState = {
  readonly status: string
  readonly episodeId?: string | null
  readonly failure?: { readonly code: string; readonly message: string } | null
}

const parseFrames = (wire: string) =>
  wire
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split(/\r?\n/)
      expect(lines.some((line) => line.startsWith("event:"))).toBe(false)
      const id = Number(lines.find((line) => line.startsWith("id:"))?.slice(3))
      const data = lines.find((line) => line.startsWith("data:"))?.slice(5)
      expect(Number.isSafeInteger(id)).toBe(true)
      expect(data).toBeTruthy()
      const event = JSON.parse(data ?? "null")
      expect(EventSchemas.safeParse(event).success).toBe(true)
      return { id, event }
    })

test("OpenAPI-driven browser flow generates and plays a real podcast", async ({
  page,
}) => {
  const password = process.env.DEV_AUTH_PASSWORD
  test.skip(!password, "DEV_AUTH_PASSWORD is required for the live stack smoke")

  await page.goto("/docs")
  await expect(page.locator("body")).toContainText("News Podcast API")
  const openApi = await page.evaluate(async () => {
    const response = await fetch("/openapi.json")
    return response.json() as Promise<{
      openapi: string
      paths: Record<string, unknown>
    }>
  })
  expect(openApi.openapi).toBe("3.1.0")
  for (const path of [
    "/v1/episode-jobs",
    "/v1/episode-jobs/{jobId}",
    "/v1/episode-jobs/{jobId}/events",
    "/v1/episodes/{episodeId}/audio",
  ]) {
    expect(openApi.paths).toHaveProperty(path)
  }

  await page.goto("/")
  await page.getByLabel("開発パスワード").fill(password ?? "")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()

  await page
    .getByRole("button", {
      name: /^(番組を生成|記事を選び直して再生成|新規生成)$/,
    })
    .click()
  await expect(
    page.getByRole("heading", { name: "番組にする記事を選ぶ" })
  ).toBeVisible()
  const candidates = page.getByRole("checkbox")
  await expect(candidates.first()).toBeVisible()
  await candidates.first().click()

  const receiptResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/episode-jobs"
  )
  await page.getByRole("button", { name: "この記事で生成" }).click()
  const receipt = (await (await receiptResponse).json()) as JobReceipt

  let state: JobState | undefined
  await expect
    .poll(
      async () => {
        state = await page.evaluate(async (jobId) => {
          const response = await fetch(`/v1/episode-jobs/${jobId}`)
          if (!response.ok)
            throw new Error(`job lookup failed: ${response.status}`)
          return response.json() as Promise<JobState>
        }, receipt.id)
        if (state.status === "failed" || state.status === "canceled") {
          throw new Error(
            `generation ${state.status}: ${state.failure?.code ?? "unknown"} ${state.failure?.message ?? ""}`
          )
        }
        return state.status
      },
      { timeout: 7 * 60_000, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe("succeeded")

  await expect(page.getByText("完成", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Podcast生成の進捗" })
  ).toBeVisible()

  const replay = await page.evaluate(async (jobId) => {
    const response = await fetch(`/v1/episode-jobs/${jobId}/events`, {
      headers: { Accept: "text/event-stream" },
    })
    return response.text()
  }, receipt.id)
  const frames = parseFrames(replay)
  expect(frames.length).toBeGreaterThan(10)
  expect(frames.map(({ event }) => event.type)).toEqual(
    expect.arrayContaining([
      "STATE_SNAPSHOT",
      "RUN_STARTED",
      "STEP_STARTED",
      "STEP_FINISHED",
      "RUN_FINISHED",
    ])
  )
  expect(frames.map(({ id }) => id)).toEqual(
    [...frames.map(({ id }) => id)].sort((left, right) => left - right)
  )

  const resumeAfter = frames.at(-2)?.id ?? 0
  const resumed = await page.evaluate(
    async ({ jobId, after }) => {
      const response = await fetch(`/v1/episode-jobs/${jobId}/events`, {
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": String(after),
        },
      })
      return response.text()
    },
    { jobId: receipt.id, after: resumeAfter }
  )
  expect(parseFrames(resumed).map(({ id }) => id)).toEqual([frames.at(-1)?.id])

  const episodeId = state?.episodeId
  expect(episodeId).toBeTruthy()
  let episode: { readonly title: string } | undefined
  await expect
    .poll(async () => {
      episode = await page.evaluate(async (id) => {
        const response = await fetch(`/v1/episodes/${id}`)
        return response.ok
          ? ((await response.json()) as { readonly title: string })
          : undefined
      }, episodeId)
      return episode?.title
    })
    .toBeTruthy()

  await page.getByRole("link", { name: "ライブラリ" }).click()
  const title = page.getByRole("heading", { name: episode?.title ?? "" })
  await expect(title).toBeVisible()
  await title
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "再生" })
    .click()
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    new RegExp(`/v1/episodes/${episodeId}/audio`)
  )
  const audio = await page.evaluate(async (id) => {
    const response = await fetch(`/v1/episodes/${id}/audio`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      size: bytes.byteLength,
      magic: String.fromCharCode(...bytes.slice(0, 4)),
    }
  }, episodeId)
  expect(audio).toMatchObject({ ok: true, magic: "RIFF" })
  expect(audio.contentType).toContain("audio/wav")
  expect(audio.size).toBeGreaterThan(44)
})
