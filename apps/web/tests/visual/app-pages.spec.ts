import { createRequire } from "node:module"
import { expect, test, type Page } from "@playwright/test"

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js")

const pages = [
  { path: "/", title: "今日のニュース番組", snapshot: "today" },
  { path: "/subscriptions", title: "購読フィード", snapshot: "subscriptions" },
  { path: "/schedule", title: "生成時刻", snapshot: "schedule" },
  { path: "/library", title: "ライブラリ", snapshot: "library" },
] as const

async function expectNoAccessibilityViolations(page: Page) {
  await page.addScriptTag({ path: axePath })
  const violations = await page.evaluate(async () => {
    const axe = (
      window as typeof window & {
        axe: {
          run: (root: Document) => Promise<{
            violations: Array<{
              id: string
              impact: string | null
              nodes: Array<{
                failureSummary?: string
                html: string
                target: string[]
              }>
            }>
          }>
        }
      }
    ).axe
    const result = await axe.run(document)
    return result.violations.flatMap(({ id, impact, nodes }) =>
      nodes.map(({ failureSummary, html, target }) => ({
        failureSummary,
        html,
        target,
        id,
        impact,
      }))
    )
  })

  expect(violations).toEqual([])
}

async function expectStablePage(page: Page, snapshot: string) {
  await page.evaluate(() => document.fonts.ready)
  await expectNoAccessibilityViolations(page)
  await expect(page).toHaveScreenshot(`${snapshot}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  })
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    test(`${theme} ${viewport.name} application pages remain stable and accessible`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("theme", selectedTheme)
      }, theme)

      const suffix = `${viewport.name}-${theme}`
      await page.goto("/login")
      await expect(
        page.getByRole("heading", { name: "ログイン" })
      ).toBeVisible()
      await expectStablePage(page, `login-${suffix}`)

      await page.getByLabel("開発パスワード").fill("e2e-password")
      await page.getByLabel("開発パスワード").press("Enter")
      await expect(
        page.getByRole("heading", { name: "今日のニュース番組" })
      ).toBeVisible()

      for (const appPage of pages) {
        await page.goto(appPage.path)
        await expect(
          page
            .getByRole("heading", { name: appPage.title, exact: true })
            .first()
        ).toBeVisible()
        await expectStablePage(page, `${appPage.snapshot}-${suffix}`)
      }
    })
  }
}
