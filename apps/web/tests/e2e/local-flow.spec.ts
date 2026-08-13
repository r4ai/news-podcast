import { expect, test } from "@playwright/test"

test("unauthenticated deep links never render protected content", async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(
      window as typeof window & { sawProtectedContent?: boolean }
    ).sawProtectedContent = false
    new MutationObserver(() => {
      if (document.body?.textContent?.includes("購読フィード")) {
        ;(
          window as typeof window & { sawProtectedContent?: boolean }
        ).sawProtectedContent = true
      }
    }).observe(document.documentElement, { childList: true, subtree: true })
  })

  await page.goto("/subscriptions")
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsubscriptions/)
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { sawProtectedContent?: boolean })
            .sawProtectedContent
      )
    )
    .toBe(false)
})

test("stored dark theme is applied before the login page renders", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"))
  await page.goto("/login")

  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
})

test("stored light theme overrides a dark operating-system preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.addInitScript(() => localStorage.setItem("theme", "light"))
  await page.goto("/login")

  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light")
})

test("system theme follows the operating-system preference before React starts", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.addInitScript(() => localStorage.setItem("theme", "system"))
  await page.goto("/login")

  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
})

test("authentication service failures stay on a retryable error screen", async ({
  page,
}) => {
  await page.route("**/api/auth/state", (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "authentication unavailable" }),
      contentType: "application/json",
      status: 503,
    })
  )

  await page.goto("/subscriptions")

  await expect(page).toHaveURL(/\/subscriptions$/)
  await expect(
    page.getByRole("heading", { name: "接続を確認してください" })
  ).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
})

test("login returns to the requested protected route", async ({ page }) => {
  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await expect(page).toHaveURL(/\/subscriptions$/)
  await expect(
    page.getByRole("heading", { name: "購読フィード" })
  ).toBeVisible()
})

test("login accepts Enter submission but rejects an external return URL", async ({
  page,
}) => {
  await page.goto("/login?redirect=https%3A%2F%2Fexample.com%2Fphishing")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByLabel("開発パスワード").press("Enter")

  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
})

test("a protected API 401 clears the visible app and preserves the return path", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()

  let expired = false
  await page.route("**/api/auth/state", async (route) => {
    if (!expired) {
      await route.continue()
      return
    }
    await route.fulfill({
      body: JSON.stringify({
        authenticated: false,
        loginMethods: { development: true, google: false },
      }),
      contentType: "application/json",
      status: 200,
    })
  })
  // 「番組を生成」は記事選択ダイアログを開き、そこで候補を取りにいく。
  // その保護APIが401を返したときにアプリが消えて復帰先が保たれることを見る。
  await page.route("**/v1/me/articles**", async (route) => {
    expired = true
    await route.fulfill({
      body: JSON.stringify({ error: "session expired" }),
      contentType: "application/json",
      status: 401,
    })
  })
  await page.getByRole("button", { name: "番組を生成" }).click()

  await expect(page).toHaveURL(/\/login\?redirect=%2F$/)
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible()
})

test("generation schedule form is keyboard accessible and saves without a page reload", async ({
  page,
}) => {
  await page.goto("/schedule")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  const automaticGeneration = page.getByRole("switch", {
    name: "毎日自動生成する",
  })
  let finishSave = () => {}
  const saveBlocked = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  await page.route("**/v1/me/settings", async (route) => {
    if (route.request().method() === "PATCH") await saveBlocked
    await route.continue()
  })
  await automaticGeneration.click()
  await page.getByLabel("時刻").fill("08:15")
  await page.getByLabel("タイムゾーン").fill("UTC")
  await page.getByRole("option", { name: "UTC", exact: true }).click()
  const saveButton = page.getByRole("button", { name: "設定を保存" })
  await saveButton.click()
  await expect(page.getByRole("button", { name: "保存中…" })).toBeDisabled()
  finishSave()

  await expect(page.getByText("生成時刻を保存しました")).toBeVisible()
  await expect(page).toHaveURL(/\/schedule$/)
  await expect(page.getByLabel("時刻")).toHaveValue("08:15")
})

test("subscription changes confirm destructive actions and roll back failed optimistic updates", async ({
  page,
}) => {
  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await page.getByRole("button", { name: "削除", exact: true }).first().click()
  await expect(
    page.getByRole("heading", { name: "購読を削除しますか？" })
  ).toBeVisible()
  await page.getByRole("button", { name: "キャンセル" }).click()

  let finishRequest = () => {}
  const requestBlocked = new Promise<void>((resolve) => {
    finishRequest = resolve
  })
  await page.route("**/v1/me/feed-subscriptions/*", async (route) => {
    await requestBlocked
    await route.fulfill({
      body: JSON.stringify({ error: "update failed" }),
      contentType: "application/json",
      status: 500,
    })
  })

  const zenn = page.getByRole("switch", {
    name: "Zennを生成対象にする",
  })
  await expect(zenn).toBeChecked()
  await zenn.click()
  await expect(zenn).not.toBeChecked()
  finishRequest()

  await expect(page.getByText("購読設定を更新できませんでした")).toBeVisible()
  await expect(zenn).toBeChecked()
})

test("RSS reader reports unavailable raw archives and persists saved state", async ({
  page,
}) => {
  const stylesheetHash = "a".repeat(64)
  const article = {
    id: "00000000-0000-4000-8000-000000000020",
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: "保存された記事",
    url: "https://example.com/article",
    publishedAt: "2026-08-10T00:00:00.000Z",
    discoveredAt: "2026-08-10T00:01:00.000Z",
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    archiveUrl: "/v1/me/articles/00000000-0000-4000-8000-000000000020/archive",
    markdownUrl:
      "/v1/me/articles/00000000-0000-4000-8000-000000000020/markdown",
  }
  const archiveErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") archiveErrors.push(message.text())
  })
  await page.context().route(`**${article.archiveUrl}`, (route) =>
    route.fulfill({
      body: `<!doctype html><html><head><title>保存された記事</title><link rel="stylesheet" href="assets/${stylesheetHash}"></head><body><main><h1>保存された記事</h1><p>保存時点の本文です。</p></main></body></html>`,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy":
          "sandbox allow-same-origin; default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self'; frame-ancestors 'self'",
      },
    })
  )
  await page.context().route(`**/assets/${stylesheetHash}`, (route) =>
    route.fulfill({
      body: "body { background: rgb(240, 244, 248); } h1 { color: rgb(17, 24, 39); font-size: 32px; }",
      contentType: "text/css",
    })
  )
  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) =>
      route.fulfill({
        body: JSON.stringify({ items: [article], page: { hasMore: false } }),
        contentType: "application/json",
      })
  )
  await page.route(`**${article.markdownUrl}`, (route) =>
    route.fulfill({ body: "", contentType: "text/markdown" })
  )
  await page.route(
    (url) => url.pathname === `/v1/me/articles/${article.id}`,
    async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          body: JSON.stringify(article),
          contentType: "application/json",
        })
      }
      if (route.request().method() !== "PATCH") return route.continue()
      const update = route.request().postDataJSON() as {
        read?: boolean
        saved?: boolean
      }
      await route.fulfill({
        body: JSON.stringify({ ...article, ...update }),
        contentType: "application/json",
      })
    }
  )

  await page.goto("/articles")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  const search = page.getByLabel("記事を検索")
  if (!(await search.isVisible())) {
    await page.getByRole("button", { name: "検索を開く" }).click()
  }
  await expect(search).toBeVisible()
  const articleButton = page.getByRole("button", { name: /保存された記事/ })
  await articleButton.focus()
  await articleButton.press("Enter")
  await expect(
    page.getByRole("heading", { name: "保存された記事" })
  ).toBeVisible()
  await expect(
    page.getByText("本文もアーカイブも利用できません。")
  ).toBeVisible()
  await expect(page.locator(`iframe[title="${article.title}"]`)).toHaveCount(0)
  expect(archiveErrors).toEqual([])

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileNavigation = page.getByRole("navigation", {
    name: "モバイルナビゲーション",
  })
  const saveButton = page.getByRole("button", { name: "保存", exact: true })
  const [navigationBox, saveButtonBox] = await Promise.all([
    mobileNavigation.boundingBox(),
    saveButton.boundingBox(),
  ])
  expect(navigationBox).not.toBeNull()
  expect(saveButtonBox).not.toBeNull()
  expect(saveButtonBox!.y + saveButtonBox!.height).toBeLessThanOrEqual(
    navigationBox!.y
  )
  await saveButton.click()
  await expect(saveButton).toHaveAttribute("aria-pressed", "true")
})

test("development login to generated episode playback completes", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
  await page.getByRole("link", { name: "購読" }).click()
  await expect(
    page.getByRole("heading", { name: "購読フィード" })
  ).toBeVisible()
  await expect(page.getByText("Zenn", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "今日" }).click()
  await page.getByRole("button", { name: "番組を生成" }).click()
  // 生成前に対象記事を選ぶ（選択フロー自体は専用テストで検証する）。
  await page.getByRole("checkbox").first().click()
  await page.getByRole("button", { name: "この記事で生成" }).click()
  await expect(page.getByText("完成", { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText("試行 1/4", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "ライブラリ" }).click()
  await expect(
    page.getByRole("heading", { name: "今日の開発ニュース" })
  ).toBeVisible()
  await page.getByRole("button", { name: "再生" }).click()
  await expect(page.locator("audio")).toHaveAttribute("src", /\/v1\/audio\//)
  await page.getByRole("button", { name: "出典を確認" }).click()
  await expect(
    page.getByRole("link", { name: "ローカルE2Eニュース" })
  ).toHaveAttribute("href", "https://example.com/local-news")
})

test("selecting articles generates an episode and streams the agent's work", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()

  // 生成前に対象記事を選ばせる。未選択では生成できない。
  await page.getByRole("button", { name: "番組を生成" }).click()
  await expect(
    page.getByRole("heading", { name: "番組にする記事を選ぶ" })
  ).toBeVisible()
  const generate = page.getByRole("button", { name: "この記事で生成" })
  await expect(generate).toBeDisabled()

  const checkboxes = page.getByRole("checkbox")
  await checkboxes.first().click()
  await checkboxes.nth(1).click()
  await expect(page.getByText("2/20件を選択中")).toBeVisible()

  const jobRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/episode-jobs") && request.method() === "POST"
  )
  await generate.click()

  // 選んだ2件がそのままリクエストに乗る。
  const body = (await jobRequest).postDataJSON() as {
    trigger: string
    articleIds: string[]
  }
  expect(body.trigger).toBe("manual")
  expect(body.articleIds).toHaveLength(2)

  // SSEでエージェントの作業が実況され、採用記事が並ぶ。
  await expect(
    page.getByRole("heading", { name: "エージェントの作業" })
  ).toBeVisible()
  await expect(page.getByText("記事を読む")).toBeVisible()
  await expect(page.getByText(/採用した記事 \d+件/)).toBeVisible()

  // 最後まで通って番組が完成する。
  await expect(page.getByText("完成", { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    page.getByText("今日の開発ニュース", { exact: true })
  ).toBeVisible()
})
