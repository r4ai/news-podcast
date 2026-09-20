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
  await page.getByRole("button", { name: "閉じる", exact: true }).hover()
}

/** 掴み代を掴んで`distance`だけ引き下げ、離す。 */
async function dragHandle(page: Page, distance: number) {
  const handle = page.getByRole("button", { name: "閉じる", exact: true })
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
  const box = await page
    .getByRole("button", { name: "閉じる", exact: true })
    .boundingBox()
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
  await page.getByRole("button", { name: "閉じる", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("Escapeでも閉じる。音は止めない", async ({ page }) => {
  await openDrawer(page)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "再生中の番組" })).toBeVisible()
})

test("指が掴み代の外で離れた後でも、押して閉じられる", async ({ page }) => {
  await openDrawer(page)
  const handle = page.getByRole("button", { name: "閉じる", exact: true })

  /*
    閾値には届かない幅だけ引いて、掴み代の**外**で離す。そこでは`click`が
    来ないので、「引いて戻した」印を同じ操作の`click`が食べる前提で消して
    いると立ちっぱなしになり、次に押したときその印を食べて何も起きない。
  */
  await dragHandle(page, 40)
  await expect(page.getByRole("dialog")).toBeVisible()

  await handle.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("引いて閉じた後、もう一度開いても面はその場に立つ", async ({ page }) => {
  await openDrawer(page)
  await dragHandle(page, 160)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  /*
    引いて閉じるときは「離した位置から続けて下へ送り出す」ため、面を画面外へ
    寄せたままにする。その印を降ろさないと、**次に開いたときも寄ったまま**
    立ち上がり、背面だけを塞ぐ見えない面になる。
  */
  const bar = page.getByRole("region", { name: "再生中の番組" })
  await bar.getByRole("button", { name: /Durable Objects/ }).click()
  const drawer = page.getByRole("dialog")
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByRole("link", { name: "原稿と出典を読む" })
  ).toBeInViewport()
})

test("開き直して掴み代を押しても、前回の引き代で飛ばない", async ({ page }) => {
  await openDrawer(page)
  await dragHandle(page, 160)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  const bar = page.getByRole("region", { name: "再生中の番組" })
  await bar.getByRole("button", { name: /Durable Objects/ }).click()
  const drawer = page.getByRole("dialog")
  await expect(drawer).toBeVisible()
  const handle = page.getByRole("button", { name: "閉じる", exact: true })
  await handle.hover()
  const before = (await drawer.boundingBox())!

  /*
    押しただけで、まだ指は動いていない。引き代を戻していないと、この瞬間に
    前回引いた分だけ面が下へ飛ぶ。
  */
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(150)
  const after = (await drawer.boundingBox())!
  await page.mouse.up()

  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)
})
