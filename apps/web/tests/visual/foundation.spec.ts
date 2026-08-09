import { expect, test } from "@playwright/test"

const storyUrl = (name: "ready" | "running" | "succeeded") =>
  `/iframe.html?id=foundation-podcast-dashboard--${name}&viewMode=story`

test("desktop dashboard remains dense and readable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(storyUrl("ready"))

  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
  await expect(page.getByText("購読フィード", { exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot("podcast-dashboard-desktop.png")
})

test("mobile dashboard stacks summaries without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(storyUrl("ready"))

  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((element) => element.clientWidth)
  )
  await expect(page).toHaveScreenshot("podcast-dashboard-mobile.png")
})

test("generation and completed states expose their semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(storyUrl("running"))
  await expect(
    page.getByRole("progressbar", { name: "音声を生成中" })
  ).toHaveAttribute("aria-valuenow", "75")

  await page.goto(storyUrl("succeeded"))
  await expect(
    page.getByText("今日のテックニュース", { exact: true })
  ).toBeVisible()
})
