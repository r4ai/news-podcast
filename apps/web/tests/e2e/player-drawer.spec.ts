import { expect, test, type Page } from "@playwright/test"

/** 偽Gatewayが固定で持つ番組。`fakeApiIdentifiers.episodeId`と同じ値。 */
const SEEDED_EPISODE_ID = "00000000-0000-4000-8000-000000000030"

/**
 * 狭い幅で開く再生バーのDrawer。
 *
 * 掴み代は「引き下げて閉じられる」と言う形をしている。言うだけで手を付けないと
 * 引けそうに見えて引けない面になるので、実際に引けること・少し引いて戻した
 * だけでは閉じないこと・押しても閉じることを、実ブラウザの操作で固定する。
 */
test.use({ viewport: { width: 390, height: 800 } })

async function openDrawer(page: Page) {
  await page.goto("/login")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByLabel("開発パスワード").press("Enter")
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()

  await page.addInitScript((episodeId: string) => {
    localStorage.setItem(
      "player.track",
      JSON.stringify({
        episodeId,
        title: "今日の開発ニュース: Durable ObjectsとTypeScript 6.0",
        createdAt: "2026-08-18T21:00:00.000Z",
      })
    )
    localStorage.setItem(
      "player.progress",
      JSON.stringify({
        [episodeId]: { position: 12, duration: 30, updatedAt: 1 },
      })
    )
  }, SEEDED_EPISODE_ID)
  await page.goto(`/library?episode=${SEEDED_EPISODE_ID}`)

  const bar = page.getByRole("region", { name: "再生中の番組" })
  await expect(bar).toBeVisible()
  // 開くのは題名。開くための専用ボタンは置いていない。
  await bar.getByRole("button", { name: /Durable Objects/ }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  /*
    滑り込みが終わるまで待つ。`toBeVisible`は動き始めた時点で真になるので、
    そこで座標を取ると、掴み代は読んだ場所からまだ動く。実測では126px下に
    居る最中の座標を掴み、押した先が背面になっていた。
  */
  await page.getByRole("button", { name: "閉じる" }).hover()
}

/** 掴み代を掴んで`distance`だけ引き下げ、離す。 */
async function dragHandle(page: Page, distance: number) {
  const handle = page.getByRole("button", { name: "閉じる" })
  // 動きが止まるまで待ってから座標を読む。
  await handle.hover()
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + distance, { steps: 8 })
  await page.mouse.up()
}

test("掴み代は指で掴める広さを持つ", async ({ page }) => {
  await openDrawer(page)
  const box = await page.getByRole("button", { name: "閉じる" }).boundingBox()
  expect(box).not.toBeNull()
  // 見えている棒は9pxしかない。掴める広さは外側のボタンが持つ。
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(20)
})

test("少し引いて離しただけでは閉じない。元の位置へ戻る", async ({ page }) => {
  await openDrawer(page)
  await dragHandle(page, 30)
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("引き下げると閉じる", async ({ page }) => {
  await openDrawer(page)
  await dragHandle(page, 160)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("掴み代を押しても閉じる", async ({ page }) => {
  await openDrawer(page)
  await page.getByRole("button", { name: "閉じる" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("Escapeでも閉じる。音は止めない", async ({ page }) => {
  await openDrawer(page)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "再生中の番組" })).toBeVisible()
})
