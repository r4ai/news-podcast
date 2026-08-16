import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import type { Page } from "@playwright/test"

/**
 * 計測はページ側の`web-vitals`にやらせる。paint entryを自分で読むと、
 * LCPの確定条件やCLSのセッション窓の扱いを二重に実装することになる。
 *
 * iife版はexports mapに載っていないので、解決できるエントリから辿る。
 */
const webVitalsScript = path.join(
  path.dirname(createRequire(import.meta.url).resolve("web-vitals")),
  "web-vitals.iife.js"
)

export type Vitals = {
  readonly TTFB?: number
  readonly FCP?: number
  readonly LCP?: number
  readonly CLS?: number
  readonly INP?: number
}

declare global {
  interface Window {
    __vitals?: Record<string, number>
  }
}

/**
 * 中位のモバイル端末と携帯回線を想定した抑制。
 *
 * 抑制しないと、開発機の速さとlocalhostの帯域が差を潰してしまう。特に帯域は
 * 重要で、無制限のままだと280 kBのバンドルが一瞬で届き、分割の効果がFCPにも
 * LCPにも出ない。「速いから問題ない」という誤った結論を防ぐための設定。
 */
export const CPU_THROTTLE_RATE = 4
export const NETWORK_PROFILE = {
  offline: false,
  // Slow 4G相当。
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
} as const

export async function throttle(page: Page, rate = CPU_THROTTLE_RATE) {
  const session = await page.context().newCDPSession(page)
  await session.send("Network.enable")
  await session.send("Emulation.setCPUThrottlingRate", { rate })
  await session.send("Network.emulateNetworkConditions", { ...NETWORK_PROFILE })
  return session
}

/**
 * 計測を仕込む。`page.goto`より前に呼ぶこと。
 *
 * `addInitScript`は与えたソースを関数スコープで包むので、iifeが作る
 * `var webVitals`はグローバルにならない。明示的に載せ替える。
 */
export async function installVitals(page: Page) {
  await page.addInitScript({
    content: `${readFileSync(webVitalsScript, "utf8")};globalThis.webVitals=webVitals;`,
  })
  await page.addInitScript(() => {
    window.__vitals = {}
    const record = (metric: { name: string; value: number }) => {
      window.__vitals![metric.name] = metric.value
    }
    // LCPとCLSは後から伸びる。確定を待たずに最新値を読めるようにする。
    const live = { reportAllChanges: true }
    const vitals = (
      window as unknown as {
        webVitals: Record<string, (cb: unknown, opts?: unknown) => void>
      }
    ).webVitals
    vitals.onTTFB(record)
    vitals.onFCP(record)
    vitals.onLCP(record, live)
    vitals.onCLS(record, live)
    vitals.onINP(record, live)
  })
}

export async function readVitals(page: Page): Promise<Vitals> {
  return page.evaluate(() => ({ ...window.__vitals }) as Vitals)
}

export type TransferReport = {
  readonly scriptBytes: number
  readonly styleBytes: number
  readonly requests: number
}

export type TransferTracker = {
  read: () => Promise<TransferReport>
  reset: () => void
}

/**
 * 落ちてきた資産量を数える。バンドル分割の効き目が最初に出る指標。
 *
 * ページ側の`PerformanceResourceTiming`は使えない。OTelの
 * `FetchInstrumentation`が`clearTimingResources: true`で
 * `performance.clearResourceTimings()`を呼び、バッファを空にするため。
 * ブラウザの外側で数えれば、計測対象のコードに影響されない。
 */
export function trackTransfer(page: Page): TransferTracker {
  let pending: Array<Promise<{ url: string; bytes: number }>> = []

  page.on("response", (response) => {
    pending.push(
      response
        .request()
        .sizes()
        .then((sizes) => ({
          url: response.url(),
          bytes: sizes.responseBodySize,
        }))
        .catch(() => ({ url: response.url(), bytes: 0 }))
    )
  })

  return {
    reset: () => {
      pending = []
    },
    read: async () => {
      const resources = await Promise.all(pending)
      const sum = (suffix: string) =>
        resources
          .filter(({ url }) => new URL(url).pathname.endsWith(suffix))
          .reduce((total, { bytes }) => total + bytes, 0)
      return {
        scriptBytes: sum(".js"),
        styleBytes: sum(".css"),
        requests: resources.length,
      }
    },
  }
}
