/**
 * Measures deterministic gzip budgets from a production Vite build.
 *
 * Initial assets come from index.html. Each major route comes from Vite's
 * source-keyed manifest and includes its transitive static imports, excluding
 * assets already downloaded by the initial page. Dynamic imports remain a
 * separate interaction cost and are intentionally excluded.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

import {
  bundleBudgetDefinitions,
  type BundleBudgetDefinitions,
  type RouteBundleBudgetDefinition,
} from "./bundle-budgets"

export type { BundleBudgetDefinitions } from "./bundle-budgets"

export type AssetSize = {
  readonly file: string
  readonly raw: number
  readonly gzip: number
}

export type RouteBundleSize = {
  readonly label: string
  readonly source: string
  readonly assets: readonly AssetSize[]
  readonly gzip: number
}

export type BundleReport = {
  readonly initial: readonly AssetSize[]
  readonly initialGzip: number
  readonly routes: readonly RouteBundleSize[]
}

export type ViteManifestChunk = {
  readonly file?: string
  readonly imports?: readonly string[]
  readonly css?: readonly string[]
}

export type ViteManifest = Readonly<Record<string, ViteManifestChunk>>

export type BudgetEvaluation = {
  readonly label: string
  readonly baselineGzip: number
  readonly currentGzip: number
  readonly budgetGzip: number
  readonly remainingGzip: number
  readonly reason: string
  readonly status: "within-budget" | "over-budget"
}

type ReadAsset = (file: string) => Uint8Array

const defaultDistDirectory = () => path.resolve(process.cwd(), "dist")

const measure = (file: string, readAsset: ReadAsset): AssetSize => {
  const contents = readAsset(file)
  return {
    file,
    raw: contents.byteLength,
    gzip: gzipSync(contents, { level: 9 }).length,
  }
}

/** Returns initial assets in declaration order without counting duplicates. */
export function readInitialAssets(html: string): readonly string[] {
  const patterns = [
    /<script[^>]+type="module"[^>]+src="\/([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g,
  ]
  return [
    ...new Set(
      patterns.flatMap((pattern) =>
        [...html.matchAll(pattern)].map(([, file]) => file!)
      )
    ),
  ]
}

const collectRouteAssetFiles = (
  source: string,
  manifest: ViteManifest,
  initialFiles: ReadonlySet<string>
): readonly string[] => {
  const visitedChunks = new Set<string>()
  const routeFiles = new Set<string>()

  const visit = (key: string) => {
    if (visitedChunks.has(key)) return
    visitedChunks.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Vite manifest is missing chunk: ${key}`)

    for (const file of [chunk.file, ...(chunk.css ?? [])])
      if (file && !initialFiles.has(file)) routeFiles.add(file)
    for (const imported of chunk.imports ?? []) visit(imported)
  }

  visit(source)
  return [...routeFiles]
}

export function createBundleReport(
  html: string,
  manifest: ViteManifest,
  routeDefinitions: readonly RouteBundleBudgetDefinition[],
  readAsset: ReadAsset
): BundleReport {
  const initialFiles = readInitialAssets(html)
  if (initialFiles.length === 0)
    throw new Error(
      "Production index.html contains no measurable initial assets"
    )
  const initialFileSet = new Set(initialFiles)
  const initial = initialFiles.map((file) => measure(file, readAsset))
  const routes = routeDefinitions.map(({ label, source }) => {
    const assets = collectRouteAssetFiles(source, manifest, initialFileSet).map(
      (file) => measure(file, readAsset)
    )
    return {
      label,
      source,
      assets,
      gzip: assets.reduce((total, asset) => total + asset.gzip, 0),
    }
  })

  return {
    initial,
    initialGzip: initial.reduce((total, asset) => total + asset.gzip, 0),
    routes,
  }
}

const requirePositiveNumber = (label: string, value: number) => {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a positive number`)
}

export function validateBudgetDefinitions(
  definitions: BundleBudgetDefinitions
): void {
  if (definitions.routes.length === 0)
    throw new Error("At least one route bundle budget is required")
  const all = [definitions.initial, ...definitions.routes]
  const labels = new Set<string>()
  const sources = new Set<string>()

  for (const definition of all) {
    if (!definition.reason.trim())
      throw new Error(`${definition.label} budget requires a reason`)
    requirePositiveNumber(
      `${definition.label} baselineGzip`,
      definition.baselineGzip
    )
    requirePositiveNumber(
      `${definition.label} budgetGzip`,
      definition.budgetGzip
    )
    if (definition.baselineGzip > definition.budgetGzip)
      throw new Error(`${definition.label} baseline exceeds its budget`)
    if (labels.has(definition.label))
      throw new Error(`Duplicate bundle budget label: ${definition.label}`)
    labels.add(definition.label)
  }

  for (const route of definitions.routes) {
    if (!route.source.trim())
      throw new Error(`${route.label} budget requires a manifest source`)
    if (sources.has(route.source))
      throw new Error(`Duplicate route budget source: ${route.source}`)
    sources.add(route.source)
  }
}

const parseManifest = (input: unknown): ViteManifest => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Vite manifest must be an object")
  return input as ViteManifest
}

export function collectBundleReport(
  distDirectory = defaultDistDirectory(),
  definitions: BundleBudgetDefinitions = bundleBudgetDefinitions
): BundleReport {
  validateBudgetDefinitions(definitions)
  const htmlPath = path.join(distDirectory, "index.html")
  const manifestPath = path.join(distDirectory, ".vite", "manifest.json")
  if (!existsSync(htmlPath) || !existsSync(manifestPath))
    throw new Error(
      "Production bundle not found; run `pnpm --filter web build` first."
    )

  const manifest = parseManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown
  )
  return createBundleReport(
    readFileSync(htmlPath, "utf8"),
    manifest,
    definitions.routes,
    (file) => readFileSync(path.join(distDirectory, file))
  )
}

export function evaluateBundleBudgets(
  report: BundleReport,
  definitions: BundleBudgetDefinitions = bundleBudgetDefinitions
): readonly BudgetEvaluation[] {
  validateBudgetDefinitions(definitions)
  const routeReports = new Map(
    report.routes.map((route) => [route.source, route])
  )
  const current = [
    { definition: definitions.initial, currentGzip: report.initialGzip },
    ...definitions.routes.map((definition) => {
      const route = routeReports.get(definition.source)
      if (!route)
        throw new Error(`Bundle report is missing route: ${definition.source}`)
      return { definition, currentGzip: route.gzip }
    }),
  ]

  return current.map(({ definition, currentGzip }) => ({
    label: definition.label,
    baselineGzip: definition.baselineGzip,
    currentGzip,
    budgetGzip: definition.budgetGzip,
    remainingGzip: definition.budgetGzip - currentGzip,
    reason: definition.reason,
    status:
      currentGzip <= definition.budgetGzip ? "within-budget" : "over-budget",
  }))
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`
const signedKb = (bytes: number) =>
  `${bytes > 0 ? "+" : ""}${(bytes / 1024).toFixed(1)} kB`

export function formatGithubSummary(
  evaluations: readonly BudgetEvaluation[]
): string {
  const rows = evaluations.map(
    (evaluation) =>
      `| ${evaluation.label} | ${kb(evaluation.baselineGzip)} | ${kb(evaluation.currentGzip)} | ${signedKb(evaluation.currentGzip - evaluation.baselineGzip)} | ${kb(evaluation.budgetGzip)} | ${signedKb(evaluation.remainingGzip)} | ${evaluation.status === "within-budget" ? "✅" : "❌"} |`
  )
  const reasons = evaluations.map(
    ({ label, reason }) => `- **${label}:** ${reason}`
  )
  return [
    "## Deterministic web bundle budget",
    "",
    "| Surface | Baseline | Current | Δ | Budget | Remaining | Status |",
    "| --- | ---: | ---: | ---: | ---: | ---: | :---: |",
    ...rows,
    "",
    "<details><summary>Budget rationale</summary>",
    "",
    ...reasons,
    "",
    "</details>",
    "",
  ].join("\n")
}

function main() {
  try {
    const report = collectBundleReport()
    const evaluations = evaluateBundleBudgets(report)
    const summary = formatGithubSummary(evaluations)
    console.log(summary)
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (summaryPath) appendFileSync(summaryPath, summary, "utf8")

    const failures = evaluations.filter(
      ({ status }) => status === "over-budget"
    )
    if (failures.length > 0) {
      console.error(
        `Bundle budget exceeded: ${failures.map(({ label }) => label).join(", ")}`
      )
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (path.basename(process.argv[1] ?? "") === "measure-bundle.ts") main()
