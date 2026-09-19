import { expect, test } from "@playwright/test"

import { createFakeApi } from "../../scripts/fake-api"

const candidates = Array.from({ length: 40 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
  feedId: "00000000-0000-4000-8000-000000000001",
  sourceName: "E2E",
  title: `並び順の記事 ${String(index).padStart(2, "0")}`,
  url: `https://example.com/order/${index}`,
  discoveredAt: new Date(Date.UTC(2026, 8, 12, 0, 0, 40 - index)).toISOString(),
  relevanceScore: index % 3 === 0 ? 10 : index % 3 === 1 ? null : 95,
  archiveStatus: index < 30 && index % 2 === 1 ? "pending" : "succeeded",
  read: false,
  saved: false,
  readLater: false,
  hidden: false,
}))

for (const width of [1440, 390]) {
  test(`chronological bulk selection follows visible pages and search at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    // Every viewport owns its API state, including the submitted generation job.
    const api = createFakeApi()
    await page.route(
      (url) =>
        url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/"),
      async (route) => {
        const request = route.request()
        const response = await api.fetch(
          new Request(request.url(), {
            method: request.method(),
            headers: await request.allHeaders(),
            body: request.postDataBuffer(),
          })
        )
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        })
      }
    )
    // The fake stack has no Collector; keep browser diagnostics local to this flow.
    await page.route("**/v1/telemetry/*", (route) =>
      route.fulfill({ json: {} })
    )
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error")
        errors.push(`${message.location().url}: ${message.text()}`)
    })
    const requests: URLSearchParams[] = []
    await page.route("**/v1/me/articles?*", async (route) => {
      const query = new URL(route.request().url()).searchParams
      requests.push(query)
      const searching = query.get("q") === "並び順"
      const lastPage = searching || query.has("cursor")
      const items = searching
        ? candidates.filter((item) => item.archiveStatus === "succeeded")
        : query.has("cursor")
          ? candidates.slice(30)
          : candidates.slice(0, 30)
      await route.fulfill({
        json: {
          items,
          page: {
            hasMore: !lastPage,
            ...(!lastPage ? { nextCursor: "older" } : {}),
          },
        },
      })
    })
    await page.goto("/")
    await page.getByLabel("開発パスワード").fill("e2e-password")
    await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
    await page.getByRole("button", { name: "番組を生成", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/新着順に並んでいます/)).toBeVisible()
    await expect(dialog.getByRole("checkbox")).toHaveCount(15)
    await dialog.getByRole("button", { name: "もっと読み込む" }).click()
    const visible = candidates.filter(
      (item) => item.archiveStatus === "succeeded"
    )
    const rows = dialog.getByRole("listitem")
    await expect(rows).toHaveCount(25)
    for (const [index, item] of visible.entries()) {
      await expect(rows.nth(index)).toContainText(item.title)
    }
    const select = dialog.getByRole("button", { name: "上から一括選択" })
    await select.click()
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      20
    )
    for (let index = 0; index < visible.length; index++) {
      await expect(rows.nth(index).getByRole("checkbox")).toHaveAttribute(
        "aria-checked",
        String(index < 20)
      )
    }
    await dialog.getByRole("searchbox").fill("並び順")
    await expect
      .poll(() => requests.some((query) => query.get("q") === "並び順"))
      .toBe(true)
    await expect(select).toBeEnabled()
    await select.click()
    const submission = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/v1/episode-jobs")
    )
    await dialog.screenshot({
      path: testInfo.outputPath(`picker-${width}.png`),
    })
    await dialog.getByRole("button", { name: "この記事で生成" }).click()
    expect((await submission).postDataJSON().articleIds).toEqual(
      visible.slice(0, 20).map((item) => item.id)
    )
    expect(requests.every((query) => query.get("sort") === "newest")).toBe(true)
    expect(requests.some((query) => query.get("cursor") === "older")).toBe(true)
    expect(
      requests
        .filter((query) => query.has("q"))
        .every((query) => !query.has("cursor"))
    ).toBe(true)
    expect(errors).toEqual([])
  })
}
