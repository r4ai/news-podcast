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

async function expectStablePage(
  page: Page,
  snapshot: string,
  { fullPage = true }: { readonly fullPage?: boolean } = {}
) {
  await page.evaluate(() => document.fonts.ready)
  await expectNoAccessibilityViolations(page)
  await expect(page).toHaveScreenshot(`${snapshot}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage,
    // 環境差はコンテナで消してあるので、ここが吸収するのはページ自身の
    // 実行ごとの揺れだけ。購読ページは同じコンテナで撮り直しても3%程度動く
    // (同期ジョブの相対時刻など)。レイアウト回帰は見えるまま残す。
    maxDiffPixelRatio: 0.04,
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

      // 記事ページはdesktopでページ見出しを持たない (docs/design.md §7.1) ので、
      // 一覧の行が出たことをもって安定とみなし、閲覧中の状態まで確認する。
      await page.goto("/articles")
      const firstArticle = page
        .getByRole("button", { name: /Durable Objects/ })
        .first()
      await expect(firstArticle).toBeVisible()
      await expectStablePage(page, `articles-${suffix}`)

      await firstArticle.click()
      await expect(
        page.getByRole("heading", {
          name: "Durable Objectsが東京リージョンに対応",
        })
      ).toBeVisible()
      // 題名は記事レコードから即座に出るが、本文はremark/rehypeの非同期
      // パイプライン(Shikiの言語遅延import込み)を通ってから差し替わる。
      // 題名だけを待って撮ると、ハイライト前後どちらの高さになるかが実行ごとに
      // 変わる。本文の最後に出るものを待って、完成した状態だけを撮る。
      await expect(
        page.getByRole("button", { name: "コードをコピー" })
      ).toBeVisible()
      // 目次はdisclosureと右レールの2箇所にあり、どちらが見えるかは幅次第。
      // 存在だけを確かめれば、見出しの収集まで終わったことが分かる。
      await expect(
        page
          .getByRole("navigation", { name: "目次", includeHidden: true })
          .first()
      ).toBeAttached()
      // リーダーだけviewport固定で撮る。本文は長く、行ボックスの丸めで
      // 全体の高さが実行ごとに1px動く。寸法が違うと`maxDiffPixelRatio`は
      // 効かず即失敗するので、高さが確定する撮り方にする。desktopは本文が
      // 元々viewportへ収まるので情報量は変わらず、mobileで折り返した先は
      // desktop側のスナップショットが受け持つ。
      await expectStablePage(page, `articles-reader-${suffix}`, {
        fullPage: false,
      })
    })
  }
}
