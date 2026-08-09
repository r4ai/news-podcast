import { expect, test } from "@playwright/test"

test("development login to generated episode playback completes", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("開発ユーザーのパスワード").fill("e2e-password")
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
  await expect(page.getByText(/完成 · 試行 1/)).toBeVisible({ timeout: 15_000 })

  await page.getByRole("link", { name: "ライブラリ" }).click()
  await expect(
    page.getByRole("heading", { name: "今日の開発ニュース" })
  ).toBeVisible()
  await page.getByRole("button", { name: "再生" }).click()
  await expect(page.locator("audio")).toHaveAttribute("src", /\/v1\/audio\//)
  await page.getByText("出典 1件").click()
  await expect(
    page.getByRole("link", { name: "ローカルE2Eニュース" })
  ).toHaveAttribute("href", "https://example.com/local-news")
})
