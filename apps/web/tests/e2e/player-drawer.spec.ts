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

async function openDrawer(
  page: Page,
  {
    at = `/library?episode=${SEEDED_EPISODE_ID}`,
    from = "title",
  }: { readonly at?: string; readonly from?: "title" | "surface" } = {}
) {
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
  await page.goto(at)

  const bar = page.getByRole("region", { name: "再生中の番組" })
  await expect(bar).toBeVisible()
  /*
    開くのは題名か、板の押せないところ。後者はfocusを持たないので、閉じた
    ときに戻る先が無い。`finalFocus`が効いているかは、そちらでしか見えない。
  */
  if (from === "title") {
    await bar.getByRole("button", { name: /Durable Objects/ }).click()
  } else {
    await bar.locator('[aria-hidden="true"].rounded-xl').first().click()
  }
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

/** 遷移の途中も含め、操作・alert・参照先idが重複しないことを測る。 */
async function measureOverlap(page: Page) {
  return page.evaluate(async () => {
    const selectors = [
      '[aria-label="再生位置"]',
      '[role="combobox"][aria-label^="再生速度"]',
      '[aria-label="音量"]',
      '[data-slot="player-error"]',
      '[id="now-playing-panel"]',
    ]
    const maxima = selectors.map(() => 0)
    const start = performance.now()
    while (performance.now() - start < 900) {
      selectors.forEach((selector, index) => {
        maxima[index] = Math.max(
          maxima[index]!,
          document.querySelectorAll(selector).length
        )
      })
      await new Promise(requestAnimationFrame)
    }
    return Object.fromEntries(
      selectors.map((selector, index) => [selector, maxima[index]])
    )
  })
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`幅変更を途中で折り返しても、操作が重複・消失しない: ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion })
    await openDrawer(page)
    await page.evaluate(() =>
      document.querySelector("audio")?.dispatchEvent(new Event("error"))
    )
    const [maxima] = await Promise.all([
      measureOverlap(page),
      (async () => {
        await page.setViewportSize({ width: 1440, height: 800 })
        await page.waitForTimeout(80)
        await page.setViewportSize({ width: 390, height: 800 })
        await page.waitForTimeout(80)
        await page.setViewportSize({ width: 1440, height: 800 })
      })(),
    ])
    for (const [selector, count] of Object.entries(maxima))
      expect(count, selector).toBeLessThanOrEqual(1)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("slider", { name: "音量" }).focus()
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-slot="player-expanded"]')).toHaveCount(0)
    await expect(page.getByRole("slider", { name: "再生位置" })).toHaveCount(1)
    await expect(page.getByRole("combobox", { name: /再生速度/ })).toHaveCount(
      1
    )
    await expect(page.getByRole("alert")).toHaveCount(1)
    await expect(
      page.locator('[aria-controls="now-playing-panel"]')
    ).toBeFocused()
  })
}

test("閉じる・開く・閉じるを連続しても、古い終了処理で目盛りが重複しない", async ({
  page,
}) => {
  await openDrawer(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const panel = page.locator('[data-slot="player-expanded"]')
  await panel.getByRole("slider", { name: "音量" }).hover()

  const [maxima] = await Promise.all([
    measureOverlap(page),
    page.evaluate(async () => {
      const title = document.querySelector<HTMLButtonElement>(
        '[aria-controls="now-playing-panel"]'
      )!
      title.click()
      await new Promise((resolve) => setTimeout(resolve, 100))
      title.click()
      await new Promise((resolve) => setTimeout(resolve, 160))
      title.click()
    }),
  ])
  for (const [selector, count] of Object.entries(maxima))
    expect(count, selector).toBeLessThanOrEqual(1)
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("slider", { name: "再生位置" })).toHaveCount(1)
})

test("Drawerから広幅へ移る間も、操作と失敗通知とidは1つずつ", async ({
  page,
}) => {
  await openDrawer(page)
  await page.evaluate(() =>
    document.querySelector("audio")?.dispatchEvent(new Event("error"))
  )
  const [maxima] = await Promise.all([
    measureOverlap(page),
    page.setViewportSize({ width: 1440, height: 800 }),
  ])
  for (const [selector, count] of Object.entries(maxima))
    expect(count, selector).toBeLessThanOrEqual(1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator('[data-slot="player-expanded"]')).toBeVisible()
  await expect(
    page.locator('[aria-controls="now-playing-panel"]')
  ).toBeFocused()
})

test("ドラッグ中に幅を広げたら、離した指は移動先のパネルを閉じない", async ({
  page,
}) => {
  await openDrawer(page)
  const box = (await page
    .getByRole("button", { name: "閉じる", exact: true })
    .boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 30, { steps: 3 })
  await page.setViewportSize({ width: 1440, height: 800 })
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.mouse.move(x, y + 160, { steps: 3 })
  await page.mouse.up()
  await expect(
    page.locator('[aria-controls="now-playing-panel"]')
  ).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('[data-slot="player-expanded"]')).toBeVisible()
})

for (const control of ["rate", "volume"] as const) {
  for (const width of [900, 390]) {
    test(`常設${control}のpopup内から幅${width}へ変えても、focusを失わない`, async ({
      page,
    }) => {
      await openDrawer(page)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await page.setViewportSize({ width: 1440, height: 800 })
      const bar = page.getByRole("region", { name: "再生中の番組" })
      if (control === "rate") {
        await bar.getByRole("combobox", { name: /再生速度/ }).focus()
        await page.keyboard.press("ArrowDown")
        await expect(page.getByRole("option", { name: "1.5×" })).toBeVisible()
      } else {
        await bar.getByRole("button", { name: /音量/ }).click()
        await page.getByRole("slider", { name: "音量" }).focus()
      }
      await page.setViewportSize({ width, height: 800 })
      await expect(page.getByRole("option")).toHaveCount(0)
      await expect(page.getByRole("slider", { name: "音量" })).toHaveCount(0)
      await expect(
        bar.locator('[aria-controls="now-playing-panel"]')
      ).toBeFocused()
    })
  }
}

test("掴み代は指で掴める広さを持つ", async ({ page }) => {
  await openDrawer(page)
  const box = await page
    .getByRole("button", { name: "閉じる", exact: true })
    .boundingBox()
  expect(box).not.toBeNull()
  // 見えている棒は4pxしかない。掴める広さは外側のボタンが持つ。
  // 下限はdocs/design.md §7.1のタップ対象(モバイルで44px以上)。
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
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

test.describe("タッチでのDrawer操作", () => {
  test.use({ hasTouch: true })

  test("タップで閉じ、短いスワイプでは戻り、長いスワイプで閉じる", async ({
    page,
  }) => {
    await openDrawer(page)
    await page.getByRole("button", { name: "閉じる", exact: true }).tap()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.locator('[aria-controls="now-playing-panel"]').tap()
    const handle = page.getByRole("button", { name: "閉じる", exact: true })
    const session = await page.context().newCDPSession(page)
    try {
      for (const distance of [30, 160]) {
        await handle.hover()
        const box = (await handle.boundingBox())!
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1 }],
        })
        for (let step = 1; step <= 8; step += 1) {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y + (distance * step) / 8, id: 1 }],
          })
        }
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        })
        if (distance < 96) await expect(page.getByRole("dialog")).toBeVisible()
        else await expect(page.getByRole("dialog")).toHaveCount(0)
      }
    } finally {
      await session.detach()
    }
  })
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

/*
  折りたたみ時の目盛りは、板の幅いっぱいに広がる。掴み代が常設の行の上余白
  より厚いと、そのぶん再生や閉じるの上端を覆い、そこを押すとシークしてしまう
  (実測: 再生ボタンの上8px)。
*/
test("目盛りが再生や閉じるの上端を覆わない", async ({ page }) => {
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
  }, SEEDED_EPISODE_ID)
  await page.goto(`/library?episode=${SEEDED_EPISODE_ID}`)
  await expect(page.getByRole("region", { name: "再生中の番組" })).toBeVisible()

  const covered = await page.evaluate(() => {
    const bar = document.querySelector('[data-slot="player-bar"]')!
    const hidden: string[] = []
    for (const label of ["再生", "再生を終了してバーを閉じる"]) {
      const control = bar.querySelector(`[aria-label="${label}"]`)
      if (control === null) continue
      const box = control.getBoundingClientRect()
      // 上端から1pxずつ、その点を押したときに当たるのが操作そのものか見る。
      for (const dy of [1, 3, 5, 7]) {
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + dy)
        if (hit?.closest(`[aria-label="${label}"]`) === null) {
          hidden.push(`${label}+${dy}px`)
        }
      }
    }
    return hidden
  })

  expect(covered).toEqual([])
})

/*
  掴み代の上で横や上へ払った操作は、引き代(下向き)としては0になる。それで
  続く`click`を素通りさせると、引いていないのにタップ扱いで閉じてしまう。
*/
test("掴み代を横へ払っても閉じない", async ({ page }) => {
  await openDrawer(page)
  const handle = page.getByRole("button", { name: "閉じる", exact: true })
  await handle.hover()
  const box = (await handle.boundingBox())!
  const y = box.y + box.height / 2

  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 20, y, { steps: 5 })
  await page.mouse.up()

  await expect(page.getByRole("dialog")).toBeVisible()
})

/*
  余白からDrawerを開き、中からEscapeで閉じる。Drawerが立っている間、背面の
  板はmodalがinertにしているので、こちらから`focus()`しても効かない。行き先は
  `finalFocus`へ預け、閉じ切ってから戻してもらう。
*/
test("余白から開いたDrawerを閉じても、focusは題名へ戻る", async ({ page }) => {
  await openDrawer(page, { from: "surface" })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)

  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-controls") ?? "(なし)"
  )
  expect(focused).toBe("now-playing-panel")
})

/*
  Drawerから原稿へ移る場合。

  移った先は1カラムで自分から現在地を詳細へ移す
  (`episode-detail.tsx`の`useSingleColumnFocus`)。閉じたDrawerが題名へ
  引き戻すと、その契約を破って現在地が板まで飛ぶ。
*/
test("原稿へ移って閉じたときは、題名へ引き戻さない", async ({ page }) => {
  // 別のページから開く。ここから移ると、移った先が現在地を詳細へ移す。
  await openDrawer(page, { at: "/", from: "surface" })

  await page
    .getByRole("dialog")
    .getByRole("link", { name: "原稿と出典を読む" })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  await expect(
    page.getByRole("article", { name: /Durable Objects/ })
  ).toBeFocused()
})

/*
  既にその原稿を開いている状態で、Drawerから同じ原稿へ移る場合。

  移っても現在地は動かない(`useSingleColumnFocus`は同じ番組では走らない)ので、
  向こうへ譲ると focus は題名にも詳細にも行かず`body`へ落ちる。
*/
test("同じ原稿へ移ったときは、題名へ戻す", async ({ page }) => {
  await openDrawer(page, { from: "surface" })

  await page
    .getByRole("dialog")
    .getByRole("link", { name: "原稿と出典を読む" })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-controls") ?? "(なし)"
  )
  expect(focused).toBe("now-playing-panel")
})

/*
  再生に失敗したままDrawerを閉じる間。

  `expanded`は終了の動きが始まった時点でfalseになる。それだけで板側の失敗の
  行を戻すと、まだ残っているDrawerの中の同じ`alert`と二重になる。
*/
test("Drawerを閉じている間、失敗の行が二重にならない", async ({ page }) => {
  await openDrawer(page, { from: "surface" })
  await page.evaluate(() => {
    document.querySelector("audio")?.dispatchEvent(new Event("error"))
  })
  await expect(page.getByRole("alert")).toHaveCount(1)

  await page.keyboard.press("Escape")
  // 終了の動き(350ms)の最中を覗く。
  await page.waitForTimeout(120)
  expect(await page.getByRole("alert").count()).toBeLessThanOrEqual(1)

  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("alert")).toHaveCount(1)
})

/*
  開き切る前に閉じた場合。

  `onOpenChangeComplete(true)`がまだ来ていないので、立ち上がりの動きの完了を
  待って「在る」と記録していると、この経路で取りこぼす。
*/
test("開き切る前に閉じても、失敗の行が二重にならない", async ({ page }) => {
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
  }, SEEDED_EPISODE_ID)
  await page.goto(`/library?episode=${SEEDED_EPISODE_ID}`)
  const bar = page.getByRole("region", { name: "再生中の番組" })
  await expect(bar).toBeVisible()
  await page.evaluate(() => {
    document.querySelector("audio")?.dispatchEvent(new Event("error"))
  })
  await expect(page.getByRole("alert")).toHaveCount(1)

  // 開いた直後、立ち上がりの動き(350ms)が終わる前に閉じる。
  await bar.getByRole("button", { name: /Durable Objects/ }).click()
  await page.waitForTimeout(80)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(120)

  expect(await page.getByRole("alert").count()).toBeLessThanOrEqual(1)
})

/*
  修飾キー付きのクリックは別のタブで開く。この画面は動かないので、畳むと
  見ていた面が理由もなく消える。
*/
test("別タブで開くクリックではDrawerを畳まない", async ({ page }) => {
  await openDrawer(page, { at: "/", from: "surface" })

  await page
    .getByRole("dialog")
    .getByRole("link", { name: "原稿と出典を読む" })
    .click({ modifiers: ["ControlOrMeta"] })
  await page.waitForTimeout(400)

  await expect(page.getByRole("dialog")).toBeVisible()
})

/*
  広い幅で畳む途中。

  `expanded`は終了の動きの開始時点でfalseになる。それだけで常設の行の操作を
  戻すと、まだ残っている段の中の同じ目盛り・速度・音量と二重になる。
*/
test("畳む動きの最中に、同じ操作が二重に出ない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
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
  }, SEEDED_EPISODE_ID)
  await page.goto(`/library?episode=${SEEDED_EPISODE_ID}`)
  const bar = page.getByRole("region", { name: "再生中の番組" })
  await bar.getByRole("button", { name: /Durable Objects/ }).click()
  await expect(page.locator('[data-slot="player-expanded"]')).toBeVisible()

  /*
    畳む動き(300ms)の最中を、何度も覗いて最大値を取る。1点だけ見ると、
    重なっている一瞬を跨いでしまう。
  */
  await page.keyboard.press("Escape")
  let mostSliders = 0
  let mostRates = 0
  for (let sample = 0; sample < 12; sample += 1) {
    mostSliders = Math.max(
      mostSliders,
      await bar.getByRole("slider", { name: "再生位置" }).count()
    )
    mostRates = Math.max(
      mostRates,
      await bar.getByRole("combobox", { name: /再生速度/ }).count()
    )
    await page.waitForTimeout(25)
  }
  expect(mostSliders).toBeLessThanOrEqual(1)
  expect(mostRates).toBeLessThanOrEqual(1)

  await expect(page.locator('[data-slot="player-expanded"]')).toHaveCount(0)
  await expect(bar.getByRole("slider", { name: "再生位置" })).toHaveCount(1)
})

/*
  速度の候補を開いたまま幅を縮める。

  `display`で隠すだけだと、候補はportalで外に描かれているので入口だけが消え、
  開いた面が前の位置に取り残される。
*/
test("速度の候補を開いたまま幅を縮めても、面が取り残されない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
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
  }, SEEDED_EPISODE_ID)
  await page.goto(`/library?episode=${SEEDED_EPISODE_ID}`)
  const bar = page.getByRole("region", { name: "再生中の番組" })
  await bar.getByRole("combobox", { name: /再生速度/ }).click()
  await expect(page.getByRole("option", { name: "1.5×" })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 800 })
  await page.waitForTimeout(300)

  await expect(page.getByRole("option", { name: "1.5×" })).toHaveCount(0)
})
