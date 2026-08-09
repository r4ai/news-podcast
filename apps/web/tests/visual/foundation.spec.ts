import { expect, test } from "@playwright/test"

const storyUrl = (name: "ready" | "running" | "succeeded") =>
  `/iframe.html?id=foundation-podcast-dashboard--${name}&viewMode=story`

test("desktop dashboard remains dense and readable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(storyUrl("ready"))

  await expect(page.getByRole("heading", { name: "今日の番組" })).toBeVisible()
  await expect(page.getByLabel("メインナビゲーション")).toBeVisible()
  await expect(page.getByLabel("モバイルナビゲーション")).toBeHidden()
  await expect(page).toHaveScreenshot("podcast-dashboard-desktop.png")
})

test("mobile dashboard uses bottom navigation and large tap targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(storyUrl("ready"))

  const mobileNavigation = page.getByLabel("モバイルナビゲーション")
  await expect(mobileNavigation).toBeVisible()
  await expect(page.getByLabel("メインナビゲーション")).toBeHidden()
  await expect(page).toHaveScreenshot("podcast-dashboard-mobile.png")

  const libraryLink = mobileNavigation.getByRole("link", {
    name: "ライブラリ",
  })
  await libraryLink.click()
  await expect(page).toHaveURL(/#library$/)
  await expect(page.locator("#library")).toBeInViewport()
  await expect(libraryLink).toHaveCSS("min-height", "44px")

  await expect(page).toHaveScreenshot("podcast-dashboard-mobile-library.png")
})

test("generation and completed states expose their semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(storyUrl("running"))
  await expect(
    page.getByRole("progressbar", { name: "番組生成の進捗" })
  ).toHaveAttribute("aria-valuenow", "2")

  await page.goto(storyUrl("succeeded"))
  await expect(page.getByLabel("今日のテックニュースを再生")).toBeVisible()
  await expect(page.locator("details")).toHaveAttribute("open", "")
  await expect(
    page.locator("details").getByText("Hacker News", { exact: true })
  ).toBeVisible()
})
