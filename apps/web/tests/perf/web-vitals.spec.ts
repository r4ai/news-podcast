import { expect, test, type Browser, type Page } from "@playwright/test"

import {
  installVitals,
  readVitals,
  throttle,
  trackTransfer,
  type TransferReport,
  type Vitals,
} from "./vitals"

/**
 * 本番ビルド (scripts/run-fake-preview.ts) に対する実測。
 *
 * 数字は実行環境で動くので、これは順位づけと退行検知のための道具であって
 * 絶対値の合格証ではない。予算は現状から余裕を持って引いてあり、CIでは
 * 非ブロッキングで回す。
 *
 * 計測は必ず**キャッシュが空のcontext**で行う。ログイン画面を通した後の
 * ページ内遷移を測ると、初期チャンクは既にキャッシュにあり、バンドルを
 * どれだけ削っても数字が動かない。
 */

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`
const ms = (value: number | undefined) =>
  value === undefined ? "n/a" : `${Math.round(value)} ms`

type Budget = {
  readonly path: string
  readonly name: string
  /** 表示が終わったと判断する目印。ここまでを1回の計測とする。 */
  readonly settled: (page: Page) => Promise<void>
  readonly fcp: number
  readonly lcp: number
  readonly cls: number
  readonly scriptBytes: number
}

const budgets: readonly Budget[] = [
  {
    path: "/",
    name: "dashboard",
    settled: async (page) => {
      await expect(
        page.getByRole("heading", { name: "今日のニュース番組" })
      ).toBeVisible()
    },
    fcp: 3_200,
    lcp: 3_500,
    cls: 0.1,
    scriptBytes: 300 * 1024,
  },
  {
    path: "/articles",
    name: "articles",
    settled: async (page) => {
      await expect(
        page.getByRole("button", { name: /Durable Objects/ }).first()
      ).toBeVisible()
    },
    fcp: 3_500,
    lcp: 3_800,
    cls: 0.1,
    scriptBytes: 380 * 1024,
  },
]

/** 開発ログインでcookieを取り、以降はキャッシュの無いcontextへ持ち込む。 */
async function authenticate(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByLabel("開発パスワード").fill("e2e-password")
  await page.getByLabel("開発パスワード").press("Enter")
  await expect(
    page.getByRole("heading", { name: "今日のニュース番組" })
  ).toBeVisible()
  const storageState = await context.storageState()
  await context.close()
  return storageState
}

function report(name: string, vitals: Vitals, transfer: TransferReport) {
  console.log(
    [
      `[perf] ${name}`,
      `  TTFB ${ms(vitals.TTFB)}  FCP ${ms(vitals.FCP)}  LCP ${ms(vitals.LCP)}`,
      `  CLS  ${(vitals.CLS ?? 0).toFixed(4)}`,
      `  JS   ${kb(transfer.scriptBytes)}  CSS ${kb(transfer.styleBytes)}  requests ${transfer.requests}`,
    ].join("\n")
  )
}

for (const budget of budgets) {
  test(`${budget.name} の初回表示が予算に収まる`, async ({ browser }) => {
    const storageState = await authenticate(browser)
    // 新しいcontext = 空のHTTPキャッシュ。ここが初回訪問の条件になる。
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await throttle(page)
    await installVitals(page)
    const transferTracker = trackTransfer(page)

    await page.goto(budget.path)
    await budget.settled(page)
    // LCPは要素が入れ替わるたび伸びる。落ち着くまでの猶予を一定に取る。
    await page.waitForTimeout(2_000)

    const vitals = await readVitals(page)
    const transfer = await transferTracker.read()
    report(budget.name, vitals, transfer)
    await context.close()

    expect(vitals.FCP, "FCP").toBeLessThan(budget.fcp)
    expect(vitals.LCP, "LCP").toBeLessThan(budget.lcp)
    expect(vitals.CLS ?? 0, "CLS").toBeLessThan(budget.cls)
    expect(transfer.scriptBytes, "転送されたJS").toBeLessThan(
      budget.scriptBytes
    )
  })
}

test("記事の検索入力が打鍵に追従する", async ({ browser }) => {
  const storageState = await authenticate(browser)
  const context = await browser.newContext({ storageState })
  const page = await context.newPage()
  await throttle(page)
  await installVitals(page)

  await page.goto("/articles")
  await expect(
    page.getByRole("button", { name: /Durable Objects/ }).first()
  ).toBeVisible()

  const search = page.getByRole("textbox", { name: "記事を検索" })
  await search.click()
  // 一覧が載ったまま打つ。ここが重いなら、絞り込みのたびに一覧全体が
  // 描き直されている。
  for (const char of "durable") {
    await search.press(char)
  }
  await page.waitForTimeout(1_500)

  const vitals = await readVitals(page)
  console.log(`[perf] search-typing  INP ${ms(vitals.INP)}`)
  await context.close()

  expect(vitals.INP ?? 0, "INP").toBeLessThan(500)
})
