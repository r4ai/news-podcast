import { createRequire } from "node:module"

import { expect, test, type Page } from "@playwright/test"

/**
 * 全ページのaxe検査。
 *
 * 視覚回帰(tests/visual)からは切り離す。あちらはスナップショットの基準が
 * 実行環境に縛られるため対象を絞らざるを得ないが、a11yの検査に環境差は無く、
 * 画面を増やさない理由にはならない。
 */
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js")

type Target = {
  readonly path: string
  readonly name: string
  readonly ready: (page: Page) => Promise<void>
}

const targets: readonly Target[] = [
  {
    path: "/",
    name: "今日",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "今日のニュース番組" })
      ).toBeVisible()
    },
  },
  {
    path: "/articles",
    name: "記事",
    ready: async (page) => {
      await expect(
        page.getByRole("button", { name: /Durable Objects/ }).first()
      ).toBeVisible()
    },
  },
  {
    path: "/subscriptions",
    name: "購読フィード",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "購読フィード" }).first()
      ).toBeVisible()
    },
  },
  {
    path: "/schedule",
    name: "生成時刻",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "生成時刻" }).first()
      ).toBeVisible()
    },
  },
  {
    path: "/library",
    name: "ライブラリ",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "ライブラリ" }).first()
      ).toBeVisible()
    },
  },
  {
    path: "/settings",
    name: "設定",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "読み辞書" })
      ).toBeVisible()
    },
  },
]

type Violation = {
  readonly id: string
  readonly impact: string | null
  readonly help: string
  readonly target: readonly string[]
  readonly html: string
}

export async function collectViolations(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: axePath })
  return page.evaluate(async () => {
    const { axe } = window as typeof window & {
      axe: {
        run: (root: Document) => Promise<{
          violations: Array<{
            id: string
            impact: string | null
            help: string
            nodes: Array<{ html: string; target: string[] }>
          }>
        }>
      }
    }
    const result = await axe.run(document)
    return result.violations.flatMap(({ id, impact, help, nodes }) =>
      nodes.map(({ html, target }) => ({ id, impact, help, target, html }))
    )
  })
}

async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByLabel("開発パスワード").press("Enter")
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
}

test.describe("アクセシビリティ", () => {
  test("ログイン画面に違反がない", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible()
    expect(await collectViolations(page)).toEqual([])
  })

  for (const target of targets) {
    test(`${target.name}に違反がない`, async ({ page }) => {
      await login(page)
      await page.goto(target.path)
      await target.ready(page)
      expect(await collectViolations(page)).toEqual([])
    })
  }

  test("最初のTabで本文へ入れる", async ({ page }) => {
    await login(page)
    // ナビゲーションは6本ある。毎回そこを通らないと本文へ入れないのは、
    // キーボードだけで使う利用者にとって毎ページ分の負担になる。
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "本文へスキップ" })
    await expect(skip).toBeFocused()

    await skip.press("Enter")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("生成ステータスの変化が読み上げ対象になっている", async ({ page }) => {
    await login(page)
    // 数分かけて状態が移るので、画面を見ていなくても進行が届く必要がある。
    const status = page
      .getByRole("status")
      .filter({ hasText: "題材にする記事" })
    await expect(status).toHaveAttribute("aria-live", "polite")
  })

  test("記事を開いた状態に違反がない", async ({ page }) => {
    await login(page)
    await page.goto("/articles")
    await page
      .getByRole("button", { name: /Durable Objects/ })
      .first()
      .click()
    // 本文はremark/rehypeの非同期パイプラインを通ってから差し替わる。
    // 最後に現れるものを待って、完成した木を検査する。
    await expect(
      page.getByRole("button", { name: "コードをコピー" })
    ).toBeVisible()
    expect(await collectViolations(page)).toEqual([])
  })
})
