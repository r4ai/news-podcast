/**
 * 初期ロードで必ず落ちてくる資産のgzipサイズを測る。
 *
 * `index.html`が自分で宣言しているもの (entry script、modulepreload、
 * stylesheet) だけを数える。ここが最初のフレームまでの帯域と解析時間を決める。
 * ルート遷移で追加される塊は`route`予算として別に見る。
 *
 * 実行環境に依存しない数値なので、Web Vitalsの実測と違って揺れない。
 */
import { gzipSync } from "node:zlib"
import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const distDir = fileURLToPath(new URL("../dist", import.meta.url))

export type AssetSize = {
  readonly file: string
  readonly raw: number
  readonly gzip: number
}

export type BundleReport = {
  readonly initial: readonly AssetSize[]
  readonly initialGzip: number
  readonly routes: readonly AssetSize[]
}

function measure(file: string): AssetSize {
  const absolute = path.join(distDir, file)
  return {
    file,
    raw: statSync(absolute).size,
    gzip: gzipSync(readFileSync(absolute), { level: 9 }).length,
  }
}

/** `index.html`が宣言する初期資産を、宣言順のまま拾う。 */
export function readInitialAssets(html: string): readonly string[] {
  const patterns = [
    /<script[^>]+type="module"[^>]+src="\/([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g,
  ]
  return patterns.flatMap((pattern) =>
    [...html.matchAll(pattern)].map(([, file]) => file)
  )
}

export function collectBundleReport(): BundleReport {
  const html = readFileSync(path.join(distDir, "index.html"), "utf8")
  const initial = readInitialAssets(html).map(measure)
  return {
    initial,
    initialGzip: initial.reduce((total, asset) => total + asset.gzip, 0),
    routes: [],
  }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`

/** 予算。超えたら落とす。緩めるときは理由をこの行のコメントに残す。 */
const INITIAL_GZIP_BUDGET = Number(
  process.env.PERF_INITIAL_BUDGET ?? 240 * 1024
)

function main() {
  const report = collectBundleReport()
  console.log("初期ロード資産 (index.htmlが宣言するもの)")
  for (const asset of report.initial) {
    console.log(
      `  ${asset.file.padEnd(46)} raw ${kb(asset.raw).padStart(10)}  gzip ${kb(asset.gzip).padStart(10)}`
    )
  }
  console.log(
    `  ${"合計".padEnd(46)} ${" ".repeat(15)}gzip ${kb(report.initialGzip).padStart(10)}`
  )
  console.log(`  予算 ${kb(INITIAL_GZIP_BUDGET)}`)

  if (report.initialGzip > INITIAL_GZIP_BUDGET) {
    console.error(
      `\n初期ロードが予算を ${kb(report.initialGzip - INITIAL_GZIP_BUDGET)} 超えています。`
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
