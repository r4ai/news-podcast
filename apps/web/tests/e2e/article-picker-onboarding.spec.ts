import { expect, test, type Page } from "@playwright/test"

import { createFakeApi, fakeApiIdentifiers } from "../../scripts/fake-api"

async function newOwner(page: Page, saved = false) {
  const api = createFakeApi()
  const state = { subscribed: false, ready: saved }
  const subscription = {
    id: fakeApiIdentifiers.subscriptionId,
    feedId: fakeApiIdentifiers.feedId,
    enabled: true,
    createdAt: "2026-09-20T00:00:00.000Z",
  }
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/"),
    async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path.startsWith("/v1/telemetry/")) return route.fulfill({ json: {} })
      if (path === "/v1/me/feed-subscriptions") {
        if (request.method() === "POST") {
          expect(request.postDataJSON()).toEqual({
            feedUrl: "https://zenn.dev/feed",
          })
          state.subscribed = true
          return route.fulfill({ status: 201, json: subscription })
        }
        return route.fulfill({
          json: {
            items: state.subscribed ? [subscription] : [],
            page: { hasMore: false },
          },
        })
      }
      if (path === "/v1/me/feed-sync-jobs") {
        return route.fulfill({
          json: {
            items: state.subscribed
              ? [
                  {
                    jobId: "00000000-0000-4000-8000-000000000090",
                    feedId: subscription.feedId,
                    feedUrl: "https://zenn.dev/feed",
                    status: state.ready ? "succeeded" : "processing",
                    attempt: 1,
                    maxAttempts: 4,
                    discovered: state.ready ? 3 : 0,
                    archived: state.ready ? 3 : 0,
                    failed: 0,
                    createdAt: subscription.createdAt,
                  },
                ]
              : [],
            page: { hasMore: false },
          },
        })
      }
      if (path === "/v1/me/articles") {
        return route.fulfill({
          json: {
            items: state.ready ? api.articles : [],
            page: { hasMore: false },
          },
        })
      }
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
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await page.getByRole("button", { name: "番組を生成", exact: true }).click()
  return state
}

for (const width of [1440, 390]) {
  test(`new owner reaches generation through RSS onboarding at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    const state = await newOwner(page)
    const dialog = page.getByRole("dialog")
    const add = dialog.getByRole("link", { name: "RSSフィードを追加" })
    await expect(add).toBeVisible()
    await expect(dialog.getByText(/少し待って/)).toHaveCount(0)
    // Navigate out of the modal using only Tab and Enter.
    for (
      let index = 0;
      index < 12 &&
      !(await add.evaluate((el) => el === document.activeElement));
      index++
    ) {
      await page.keyboard.press("Tab")
    }
    await expect(add).toBeFocused()
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-${width}.png`),
    })
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/subscriptions\/?$/)
    await expect(dialog).toHaveCount(0)

    await page.getByRole("combobox").fill("Zenn")
    await page.getByRole("option", { name: "Zenn" }).click()
    await page.getByRole("button", { name: "選択したフィードを追加" }).click()
    await expect(
      page.getByText("購読を追加しました", { exact: true })
    ).toBeVisible()
    await expect(page.getByText("同期中…", { exact: true })).toBeVisible()
    await page.getByRole("link", { name: "今日", exact: true }).click()
    await page.getByRole("button", { name: "番組を生成", exact: true }).click()
    await expect(dialog.getByText("記事を取り込み中です")).toBeVisible()
    await expect(
      dialog.getByRole("link", { name: "同期状況を確認" })
    ).toHaveAttribute("href", "/subscriptions")

    state.ready = true
    await dialog.getByRole("button", { name: "候補を再読み込み" }).click()
    await expect(dialog.getByRole("checkbox")).toHaveCount(3)
    await dialog.getByRole("checkbox").first().click()
    await dialog.getByRole("button", { name: "この記事で生成" }).click()
    await expect(page.getByText("完成", { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test("saved articles remain usable after every subscription is removed", async ({
  page,
}) => {
  await newOwner(page, true)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("checkbox")).toHaveCount(3)
  await expect(
    dialog.getByRole("link", { name: "RSSフィードを追加" })
  ).toHaveCount(0)
  await dialog.getByRole("checkbox").first().click()
  await dialog.getByRole("button", { name: "この記事で生成" }).click()
  await expect(page.getByText("完成", { exact: true })).toBeVisible()
})
