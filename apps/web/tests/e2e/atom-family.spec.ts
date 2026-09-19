import { expect, test } from "@playwright/test"

test("dictionary drafts stay independent and families emit no deprecation warnings", async ({
  page,
}) => {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("atomFamily is deprecated"))
      warnings.push(message.text())
  })
  await page.goto("/settings?section=dictionary")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByRole("button", { name: "開発ユーザーでログイン" }).click()
  const first = page.getByRole("listitem").filter({ hasText: "GPT-5" })
  const second = page.getByRole("listitem").filter({ hasText: "SQLite" })
  await first.getByRole("button", { name: /編集/ }).click()
  await second.getByRole("button", { name: /編集/ }).click()
  await page.getByLabel("「GPT-5」の表記").fill("GPT-5 edited")
  await page.getByLabel("「SQLite」の表記").fill("SQLite edited")
  await page.getByLabel("「GPT-5」の読み").fill("ジーピーティーゴ")
  await page.getByLabel("「SQLite」の読み").fill("エスキューエルライト")
  await page
    .getByLabel("「GPT-5」の表記")
    .locator("xpath=ancestor::li")
    .getByRole("button", { name: "保存" })
    .click()
  await expect(page.getByLabel("「SQLite」の表記")).toHaveValue("SQLite edited")
  await page
    .getByLabel("「SQLite」の表記")
    .locator("xpath=ancestor::li")
    .getByRole("button", { name: "保存" })
    .click()
  await expect(
    page.getByText("辞書を更新しました", { exact: true }).first()
  ).toBeVisible()
  await page.reload()
  await expect(page.getByText("GPT-5 edited", { exact: true })).toBeVisible()
  await expect(page.getByText("SQLite edited", { exact: true })).toBeVisible()
  await expect(
    page.getByText("ジーピーティーゴ", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("エスキューエルライト", { exact: true })
  ).toBeVisible()
  await page.goto("/library")
  const play = page.getByRole("button", { name: /を再生$/ })
  await play.first().click()
  await expect(page.locator("audio")).toHaveJSProperty("paused", false)
  const firstSrc = await page.locator("audio").getAttribute("src")
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime)
    )
    .toBeGreaterThan(0)
  await play.first().click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(
          JSON.parse(localStorage.getItem("player.progress") ?? "{}")
        )
      )
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: expect.any(Number) }),
      ])
    )
  await expect(page.locator("audio")).not.toHaveAttribute("src", firstSrc!)
  const secondSrc = await page.locator("audio").getAttribute("src")
  await page.reload()
  await expect(page.locator("audio")).toHaveAttribute("src", secondSrc!)
  for (const route of ["/", "/articles", "/subscriptions", "/schedule"]) {
    await page.goto(route)
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible()
  }
  expect(warnings).toEqual([])
})
