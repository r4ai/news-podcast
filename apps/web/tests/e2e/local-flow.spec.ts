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
  await automaticGeneration.click()
  const saveRequest = page.waitForRequest((request) => {
    if (
      request.method() !== "PATCH" ||
      !request.url().endsWith("/v1/me/settings")
    ) {
      return false
    }
    const body = request.postDataJSON() as {
      generationSchedule?: { localTime?: string; timeZone?: string }
    }
    return (
      body.generationSchedule?.localTime === "08:15" &&
      body.generationSchedule?.timeZone === "UTC"
    )
  })
  await page.getByLabel("時刻").fill("08:15")
  await page.getByLabel("タイムゾーン").fill("UTC")
  await page.getByRole("option", { name: "UTC (UTC+0)", exact: true }).click()
  await saveRequest

  await expect(page.getByText("保存済み", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/schedule$/)
  await expect(page.getByLabel("時刻")).toHaveValue("08:15")
})

test("subscription changes confirm destructive actions and roll back failed optimistic updates", async ({
  page,
}) => {
  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await page.getByRole("button", { name: "Zennの操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "削除", exact: true }).click()
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

test("refreshes RSS sync status after a subscription is deleted", async ({
  page,
}) => {
  let syncJobs: readonly Record<string, unknown>[] = [
    {
      jobId: "00000000-0000-4000-8000-000000000097",
      feedId: "00000000-0000-4000-8000-000000000001",
      feedUrl: "https://zenn.dev/feed",
      status: "succeeded",
      attempt: 1,
      maxAttempts: 4,
      discovered: 3,
      archived: 3,
      failed: 0,
      createdAt: "2026-08-13T00:00:00.000Z",
      completedAt: "2026-08-13T00:00:02.000Z",
    },
  ]
  await page.route("**/v1/me/feed-sync-jobs", (route) =>
    route.fulfill({
      body: JSON.stringify({
        items: syncJobs,
        page: { hasMore: false },
      }),
      contentType: "application/json",
    })
  )

  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await expect(page.getByText("生成対象", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Zennの操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "削除", exact: true }).click()
  await page.getByRole("button", { name: "削除する" }).click()
  syncJobs = []

  await expect(
    page.getByText("購読中のフィードはありません", { exact: true })
  ).toBeVisible()
})

test("manually queues an RSS sync and shows it in the sync status", async ({
  page,
}) => {
  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await page.getByRole("button", { name: "Zennの操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "今すぐ同期", exact: true }).click()

  await expect(page.getByText("同期を開始しました")).toBeVisible()
  await expect(page.getByText("同期中…", { exact: true })).toBeVisible()
})

test("shows RSS sync progress and refreshes the article list after completion", async ({
  page,
}) => {
  let syncStatus: "processing" | "succeeded" = "processing"
  const syncedArticle = {
    id: "00000000-0000-4000-8000-000000000099",
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Zenn",
    title: "同期完了後に追加された記事",
    url: "https://zenn.dev/synced-after-queue",
    publishedAt: "2026-08-13T00:00:00.000Z",
    discoveredAt: "2026-08-13T00:00:00.000Z",
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000098",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  }

  await page.route("**/v1/me/feed-sync-jobs", (route) =>
    route.fulfill({
      body: JSON.stringify({
        items: [
          {
            jobId: "00000000-0000-4000-8000-000000000097",
            feedId: "00000000-0000-4000-8000-000000000001",
            feedUrl: "https://zenn.dev/feed",
            status: syncStatus,
            attempt: 1,
            maxAttempts: 4,
            discovered: syncStatus === "succeeded" ? 1 : 0,
            archived: syncStatus === "succeeded" ? 1 : 0,
            failed: 0,
            createdAt: "2026-08-13T00:00:00.000Z",
            completedAt:
              syncStatus === "succeeded"
                ? "2026-08-13T00:00:02.000Z"
                : undefined,
          },
        ],
        page: { hasMore: false },
      }),
      contentType: "application/json",
    })
  )
  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) =>
      route.fulfill({
        body: JSON.stringify({
          items: syncStatus === "succeeded" ? [syncedArticle] : [],
          page: { hasMore: false },
        }),
        contentType: "application/json",
      })
  )

  await page.goto("/subscriptions")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await expect(page.getByText("同期中…", { exact: true })).toBeVisible()
  await page.goto("/articles")
  await expect(page.getByText(/RSSを同期中です/)).toBeVisible()

  syncStatus = "succeeded"
  await expect(
    // 行の保存ボタンも記事名を含むので、題名で始まる本文ボタンだけに絞る。
    page.getByRole("button", { name: /^同期完了後に追加された記事/ })
  ).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/RSSを同期中です/)).toHaveCount(0)
})

test("RSS reader replays stored HTML, CSS, and images after the source disappears", async ({
  page,
}) => {
  const stylesheetHash = "a".repeat(64)
  const imageHash = "b".repeat(64)
  const snapshotId = "00000000-0000-4000-8000-000000000021"
  const replayBaseUrl = `/v1/me/article-snapshots/${snapshotId}`
  const replayUrl = `${replayBaseUrl}/replay/index.html`
  const article = {
    id: "00000000-0000-4000-8000-000000000020",
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: "保存された記事",
    url: "https://example.com/article",
    publishedAt: "2026-08-10T00:00:00.000Z",
    discoveredAt: "2026-08-10T00:01:00.000Z",
    archiveStatus: "succeeded",
    snapshotId,
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    markdownUrl:
      "/v1/me/articles/00000000-0000-4000-8000-000000000020/markdown",
  }
  const archiveErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") archiveErrors.push(message.text())
  })
  await page.context().route(`**${replayBaseUrl}/replay`, (route) =>
    route.fulfill({
      body: JSON.stringify({ url: replayUrl }),
      contentType: "application/json",
    })
  )
  await page.context().route(`**${replayUrl}`, (route) =>
    route.fulfill({
      body: `<!doctype html><html><head><title>保存された記事</title><link rel="stylesheet" href="../assets/${stylesheetHash}.css"></head><body><main><h1>保存された記事</h1><img alt="保存画像" src="../assets/${imageHash}.png"><p>保存時点の本文です。</p></main></body></html>`,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy":
          "sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'self'",
      },
    })
  )
  await page
    .context()
    .route(`**${replayBaseUrl}/assets/${stylesheetHash}.css`, (route) =>
      route.fulfill({
        body: "body { background: rgb(240, 244, 248); } h1 { color: rgb(17, 24, 39); font-size: 32px; }",
        contentType: "text/css",
      })
    )
  await page
    .context()
    .route(`**${replayBaseUrl}/assets/${imageHash}.png`, (route) =>
      route.fulfill({
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        ),
        contentType: "image/png",
      })
    )
  await page.context().route(article.url, (route) => route.abort())
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({
      status: 503,
      body: "source unavailable",
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
  // 本文が空 = アーカイブへフォールバックする経路。応答形はOpenAPI通り
  // `application/json`の`{ markdown }`。
  await page.route(`**${article.markdownUrl}`, (route) =>
    route.fulfill({
      body: JSON.stringify({ markdown: "" }),
      contentType: "application/json",
    })
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

  // 検索欄はスクロール位置に関わらず常設で、開く操作を挟まない。
  await expect(page.getByLabel("記事を検索")).toBeVisible()
  const articleButton = page.getByRole("button", { name: /^保存された記事/ })
  await articleButton.focus()
  await articleButton.press("Enter")
  await expect(
    page.getByRole("heading", { name: "保存された記事" })
  ).toBeVisible()
  const archiveFrame = page.locator(`iframe[title="${article.title}"]`)
  await expect(archiveFrame).toBeVisible()
  await expect(archiveFrame).toHaveAttribute("sandbox", "")
  const replay = page.frameLocator(`iframe[title="${article.title}"]`)
  await expect(replay.getByText("保存時点の本文です。")).toBeVisible()
  await expect(replay.getByAltText("保存画像")).toBeVisible()
  await expect(
    replay.getByRole("heading", { name: "保存された記事" })
  ).toHaveCSS("color", "rgb(17, 24, 39)")
  expect(archiveErrors).toEqual([])

  // 狭い幅でも操作列は題名の直下に居る。以前は画面下端へ固定していたが、
  // 下端は下部ナビと再生バーの場所で、鳴らし始めると宙に浮いていた。
  await page.setViewportSize({ width: 390, height: 844 })
  const saveButton = page.getByRole("button", { name: "保存", exact: true })
  const [titleBox, saveButtonBox] = await Promise.all([
    page.getByRole("heading", { name: "保存された記事" }).boundingBox(),
    saveButton.boundingBox(),
  ])
  expect(titleBox).not.toBeNull()
  expect(saveButtonBox).not.toBeNull()
  expect(saveButtonBox!.y).toBeGreaterThanOrEqual(titleBox!.y)
  // 記事の枠の中に居る。下端に浮いていないことは、これで足りる。
  expect(
    await saveButton.evaluate((node) => node.closest("article") !== null)
  ).toBe(true)

  // 一覧へ戻る導線は取得を待たない。表示境界の外にあるので、骨組みが出る
  // 間も押せる位置に居る。
  await expect(page.getByRole("button", { name: "一覧へ戻る" })).toBeVisible()

  await saveButton.click()
  await expect(saveButton).toHaveAttribute("aria-pressed", "true")
})

test("the article list walks the server cursor and toggles save without refetching", async ({
  page,
}) => {
  const makeArticle = (index: number) => ({
    id: `00000000-0000-4000-8000-0000000003${String(index).padStart(2, "0")}`,
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: `ページング記事 ${index}`,
    url: `https://example.com/paged-${index}`,
    publishedAt: `2026-08-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`,
    discoveredAt: "2026-08-10T00:01:00.000Z",
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  })
  const first = makeArticle(1)
  const second = makeArticle(2)
  const listRequests: (string | null)[] = []

  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor")
      listRequests.push(cursor)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          cursor === null
            ? {
                items: [first],
                page: { hasMore: true, nextCursor: "Y3Vyc29yLTI" },
              }
            : { items: [second], page: { hasMore: false } }
        ),
      })
    }
  )
  await page.route(
    (url) => url.pathname === `/v1/me/articles/${first.id}`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...first,
          ...((route.request().postDataJSON() as object | null) ?? {}),
        }),
      })
  )

  await page.goto("/articles")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  await expect(
    page.getByRole("button", { name: /^ページング記事 1/ })
  ).toBeVisible()
  // 2ページ目はsentinelが視界へ入った時点で自動的に続く。
  await expect(
    page.getByRole("button", { name: /^ページング記事 2/ })
  ).toBeVisible()
  expect(listRequests).toEqual([null, "Y3Vyc29yLTI"])

  const save = page.getByRole("button", { name: "「ページング記事 1」を保存" })
  await save.click()
  await expect(
    page.getByRole("button", { name: "「ページング記事 1」の保存を解除" })
  ).toBeVisible()
  // 状態更新は応答をキャッシュへ畳み込むだけで、一覧を取り直さない。
  expect(listRequests).toEqual([null, "Y3Vyc29yLTI"])
})

test("the list header and date headings stay pinned while scrolling", async ({
  page,
}) => {
  // 2つの日付グループに跨る十分な件数を用意して、実際にスクロールさせる。
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `00000000-0000-4000-8000-0000000004${String(index).padStart(2, "0")}`,
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: `スクロール記事 ${index}`,
    url: `https://example.com/scroll-${index}`,
    publishedAt:
      index < 20 ? new Date().toISOString() : "2026-01-01T00:00:00.000Z",
    discoveredAt: new Date().toISOString(),
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  }))
  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: many, page: { hasMore: false } }),
      })
  )

  await page.goto("/articles")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  const search = page.getByLabel("記事を検索")
  await expect(search).toBeVisible()
  const before = await search.boundingBox()

  const scroller = page.locator("main div").filter({ has: search }).last()
  await scroller.evaluate((node) => {
    const box = node.closest<HTMLElement>("[class*='overflow-y-auto']") ?? node
    box.scrollTop = 1_200
  })

  // 吸着しているので、スクロール後も同じ位置に留まり操作できる。
  const after = await search.boundingBox()
  expect(after).not.toBeNull()
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1)
  await expect(search).toBeInViewport()

  // 日付見出しはヘッダーの直下に重ならずに続く。
  const heading = page.getByRole("heading", { name: "それ以前" })
  await expect(heading).toBeInViewport()
  const headingBox = await heading.boundingBox()
  expect(headingBox!.y).toBeGreaterThanOrEqual(before!.y)
})

test("the reader toc folds sideways and pins into a column", async ({
  page,
}) => {
  /*
    畳む方向は横。縦に畳んでも空いた1列は空いたままで、本文は広がらない。
    格納中は本文の並びから外れ、固定すると列になって追従する。追従は
    「包む枠の高さ」で決まるので、実際に長い本文を送って確かめる。
  */
  const article = {
    id: "00000000-0000-4000-8000-000000000050",
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: "目次のある長い記事",
    url: "https://example.com/toc",
    publishedAt: "2026-08-10T00:00:00.000Z",
    discoveredAt: "2026-08-10T00:01:00.000Z",
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    markdownUrl:
      "/v1/me/articles/00000000-0000-4000-8000-000000000050/markdown",
  }
  const section = (name: string) =>
    `## ${name}\n\n${"この節の本文です。".repeat(40)}\n\n`
  const markdown = ["最初の節", "次の節", "最後の節"].map(section).join("")

  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [article], page: { hasMore: false } }),
      })
  )
  await page.route(
    (url) => url.pathname === `/v1/me/articles/${article.id}`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(article),
      })
  )
  await page.route(`**${article.markdownUrl}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ markdown }),
    })
  )

  await page.goto("/articles")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await page.getByRole("button", { name: /^目次のある長い記事/ }).click()
  const body = page.getByRole("article", { name: "目次のある長い記事" })
  await expect(
    page.getByRole("heading", { name: "目次のある長い記事" })
  ).toBeVisible()

  // 格納中は目次の列が無いので、本文はその分だけ広い。
  const handle = page.getByRole("button", { name: "目次を開いて固定する" })
  await expect(handle).toBeVisible()
  const wideBody = await body.boundingBox()

  // 右端の掴み代へ触れると、覆いとして滑り出す。
  await handle.hover()
  const floating = page.getByRole("navigation", { name: "目次" })
  await expect(floating.getByRole("link", { name: "最後の節" })).toBeVisible()
  const viewport = page.viewportSize()!
  // 滑り込みはtransformの補間なので、収まりきるまで待ってから測る。
  await expect
    .poll(async () => {
      const box = await floating.boundingBox()
      return box === null ? Number.POSITIVE_INFINITY : box.x + box.width
    })
    .toBeLessThanOrEqual(viewport.width + 1)
  // 覆いなので、本文の幅はまだ変わらない。
  expect((await body.boundingBox())!.width).toBe(wideBody!.width)

  // 見出しの行を押すと列として固定され、本文はその分だけ狭くなる。
  await page.getByRole("button", { name: "目次を固定して常に表示する" }).click()
  await expect(handle).toHaveCount(0)
  const pinnedBody = await body.boundingBox()
  expect(pinnedBody!.width).toBeLessThan(wideBody!.width)

  const toc = page.getByRole("navigation", { name: "目次" })
  const before = await toc.boundingBox()
  const scrolled = await page.evaluate(() => {
    const reader = [...document.querySelectorAll("div")].find(
      (node) =>
        getComputedStyle(node).overflowY === "auto" &&
        node.scrollHeight > node.clientHeight + 100 &&
        node.querySelector("article") !== null
    )
    if (!reader) return 0
    reader.scrollTop = 1_200
    return reader.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)

  const after = await toc.boundingBox()
  expect(after).not.toBeNull()
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1)
  await expect(toc).toBeInViewport()

  // 同じ場所を押すと画面外へ戻り、本文の幅も戻る。
  await page.getByRole("button", { name: "目次を画面外へ格納する" }).click()
  await expect(handle).toBeVisible()
  expect((await body.boundingBox())!.width).toBe(wideBody!.width)
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
  // 生成した番組が一覧の先頭に並ぶ。行には「開く」と「鳴らす」の2つのボタンが
  // あり、鳴らす方は絵だけなので、文字を持つ方で絞る。
  const generated = page
    .getByRole("button", { name: /今日の開発ニュース/ })
    .filter({ hasText: "今日の開発ニュース" })
  await expect(generated.first()).toBeVisible()

  // 行の再生ボタンで、画面下端のバーへ載せる。
  await page
    .getByRole("button", { name: /今日の開発ニュースを再生/ })
    .first()
    .click()
  const bar = page.getByRole("region", { name: "再生中の番組" })
  await expect(bar).toBeVisible()
  // 公開音声契約はsame-originの `GET /v1/episodes/{id}/audio` (ADR-0055)。
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    /\/v1\/episodes\/[^/]+\/audio$/
  )

  // 番組を開くと、原稿と出典の両方がその場で読める。
  await generated.first().click()
  await expect(
    page.getByText("ローカル環境の生成フローが正常に完了しました。")
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: /ローカルE2Eニュース/ }).first()
  ).toHaveAttribute("href", "https://example.com/local-news")

  // 再生バーはページを跨いで残り、音も止まらない (ADR-0064)。
  // バーに載った番組の題名もリンクなので、ナビゲーションは完全一致で選ぶ。
  await page.getByRole("link", { name: "今日", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
  await expect(bar).toBeVisible()
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    /\/v1\/episodes\/[^/]+\/audio$/
  )
  await expect(page.locator("audio")).toHaveJSProperty("paused", false)
})

test("selecting articles generates an episode and streams its progress", async ({
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

  // SSEで生成段階が実況され、採用記事が並ぶ。
  await expect(
    page.getByRole("heading", { name: "Podcast生成の進捗" })
  ).toBeVisible()
  await expect(page.getByText("記事本文を固定中")).toBeVisible()
  await expect(page.getByText(/採用した記事 \d+件/)).toBeVisible()

  // 最後まで通って番組が完成する。
  await expect(page.getByText("完成", { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    page.getByText("今日の開発ニュース", { exact: true })
  ).toBeVisible()
})

test("article picker searches server candidates by tag", async ({ page }) => {
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await page.getByRole("button", { name: "番組を生成" }).click()

  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return (
      url.pathname === "/v1/me/articles" &&
      url.searchParams.get("q") === "observability"
    )
  })
  await page
    .getByRole("searchbox", { name: "候補記事を検索" })
    .fill("observability")
  await response

  await expect(
    page.getByText("Durable Objectsが東京リージョンに対応")
  ).toBeVisible()
  await expect(
    page.getByText("TypeScript 6.0のリリース候補が公開")
  ).toHaveCount(0)
})

test("switching episodes shows the next script from its beginning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()

  await page.getByRole("link", { name: "ライブラリ", exact: true }).click()
  const rows = page
    .getByRole("button", { name: /: / })
    .filter({ hasText: "・" })

  // 長い台本の番組を開いて、詳細を末尾まで送る。
  await rows.filter({ hasText: "先週の総まとめ" }).first().click()
  await expect(page.getByText("今週は以上です。").first()).toBeVisible()
  const scroller = page.locator("[data-detail-pane]")
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)

  // 別の番組へ切り替えると、題名と再生ボタンから読み始められる。
  await rows.filter({ hasText: "今日の開発ニュース" }).first().click()
  await expect(
    page.getByRole("heading", { name: /Durable ObjectsとTypeScript/ })
  ).toBeVisible()
  await expect(
    page.getByText("こんばんは。今日の開発ニュースをお届けします。")
  ).toBeVisible()
  const [top, max] = await scroller.evaluate((node) => [
    node.scrollTop,
    node.scrollHeight - node.clientHeight,
  ])
  // 切り替え先も溢れる長さでなければ、ブラウザ側の丸めで0に戻ってしまい、
  // 位置が残る回帰を見逃す。
  expect(max).toBeGreaterThan(0)
  expect(top).toBe(0)
})

test("switching between the list and the reader on one column keeps the page still", async ({
  page,
}) => {
  // 1カラム (lg未満) では一覧と本文がページのスクロールを共有する。切り替えの
  // 前後でページが動くと、先に出ている「一覧へ戻る」が飛んでから戻る =
  // レイアウトシフトになる。位置が変わってよいのは「切り替え先が描き上がった
  // その瞬間」だけで、その前 (まだ一覧が見えている間) にも後にも動かない。
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `00000000-0000-4000-8000-0000000005${String(index).padStart(2, "0")}`,
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Example Feed",
    title: `送り記事 ${index}`,
    url: `https://example.com/shift-${index}`,
    publishedAt: `2026-08-${index < 20 ? "10" : "09"}T00:00:00.000Z`,
    discoveredAt: "2026-08-10T00:01:00.000Z",
    archiveStatus: "succeeded",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  }))
  // 画面に収まらない長さの本文。短いと、本文が届いた後にスクロールが動く余地
  // 自体が無くなり、回帰を見逃す。
  const markdown = Array.from(
    { length: 60 },
    (_, index) => `## 見出し ${index}\n\n本文の段落です。${"あ".repeat(120)}\n`
  ).join("\n")

  await page.route(
    (url) => url.pathname === "/v1/me/articles",
    (route) =>
      route.fulfill({
        body: JSON.stringify({ items: many, page: { hasMore: false } }),
        contentType: "application/json",
      })
  )
  // 本文は押した後に取りに行く。一覧が画面に残ったまま待つ時間を作らないと、
  // 「まだ見えている一覧を動かしていないか」を確かめられない。
  await page.route(/\/v1\/me\/articles\/[0-9a-f-]{36}$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.fulfill({
      body: JSON.stringify(
        many.find((item) => route.request().url().includes(item.id)) ?? many[0]
      ),
      contentType: "application/json",
    })
  })
  await page.route(/\/v1\/me\/articles\/[0-9a-f-]{36}\/markdown$/, (route) =>
    route.fulfill({
      body: JSON.stringify({ markdown }),
      contentType: "application/json",
    })
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/articles")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()

  const row = page.getByRole("button", { name: /^送り記事 30/ })
  await expect(row).toBeVisible()
  await row.scrollIntoViewIfNeeded()
  const listScroll = await page.evaluate(() => window.scrollY)
  expect(listScroll).toBeGreaterThan(0)

  // 描かれた各フレームのスクロール位置と、その時「一覧へ戻る」が居たかどうか。
  type Frame = { readonly reader: boolean; readonly scrollY: number }
  const record = () =>
    page.evaluate(() => {
      const probe = window as typeof window & { frames?: Frame[] }
      probe.frames = []
      const tick = () => {
        probe.frames!.push({
          reader: [...document.querySelectorAll("button")].some((button) =>
            button.textContent?.includes("一覧へ戻る")
          ),
          scrollY: window.scrollY,
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  const framesWhere = async (reader: boolean) =>
    (
      await page.evaluate(
        () => (window as typeof window & { frames?: Frame[] }).frames!
      )
    )
      .filter((frame) => frame.reader === reader)
      .map((frame) => frame.scrollY)

  await record()
  await row.click()
  await expect(page.getByRole("button", { name: "一覧へ戻る" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "送り記事 30" })).toBeVisible()
  // 本文はremark/rehypeの非同期パイプラインを通ってから差し替わる。伸びきった
  // 後まで見て、そこまでにページが動いていないことを確かめる。
  await expect(page.getByRole("heading", { name: "見出し 59" })).toBeVisible()

  // 一覧はまだ見えている間、押す前の位置に留まる。
  const listFrames = await framesWhere(false)
  expect(listFrames.length).toBeGreaterThan(0)
  expect(listFrames).toEqual(listFrames.map(() => listScroll))
  // 本文が出てからは先頭のまま動かない。
  const readerFrames = await framesWhere(true)
  expect(readerFrames.length).toBeGreaterThan(0)
  expect(readerFrames).toEqual(readerFrames.map(() => 0))

  // 戻った先は、記事を開いた時に見ていた一覧の位置。先頭へ放り出さない。
  await record()
  await page.getByRole("button", { name: "一覧へ戻る" }).click()
  await expect(row).toBeVisible()
  await expect(page.getByRole("button", { name: "一覧へ戻る" })).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(listScroll)
  // 戻る途中も、本文が見えている間は動かない。
  const leavingFrames = await framesWhere(true)
  expect(leavingFrames).toEqual(leavingFrames.map(() => 0))
})
