import { gzipSync } from "node:zlib"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  collectBundleReport,
  createBundleReport,
  evaluateBundleBudgets,
  formatGithubSummary,
  validateBudgetDefinitions,
  type BundleBudgetDefinitions,
  type ViteManifest,
} from "./measure-bundle"

const bytes = (value: string) => Buffer.from(value.repeat(100))
const gzip = (value: Buffer) => gzipSync(value, { level: 9 }).length

const definitions: BundleBudgetDefinitions = {
  initial: {
    label: "Initial load",
    baselineGzip: 20,
    budgetGzip: 100,
    reason: "Initial blocking budget with measured baseline.",
  },
  routes: [
    {
      label: "Articles",
      source:
        "src/routes/_authenticated/articles/index.tsx?tsr-split=component",
      baselineGzip: 10,
      budgetGzip: 100,
      reason: "First measured route budget.",
    },
  ],
}

describe("deterministic bundle budgets", () => {
  it("measures each route's static payload without recounting initial assets", () => {
    const files = new Map([
      ["assets/entry.js", bytes("entry")],
      ["assets/initial.css", bytes("css")],
      ["assets/articles.js", bytes("articles")],
      ["assets/route-shared.js", bytes("route-shared")],
    ])
    const manifest: ViteManifest = {
      "src/routes/_authenticated/articles/index.tsx?tsr-split=component": {
        file: "assets/articles.js",
        imports: ["_route-shared.js", "index.html"],
      },
      "_route-shared.js": { file: "assets/route-shared.js" },
      "index.html": { file: "assets/entry.js", css: ["assets/initial.css"] },
    }

    const report = createBundleReport(
      '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/initial.css">',
      manifest,
      definitions.routes,
      (file) => files.get(file) ?? Buffer.alloc(0)
    )

    expect(report.initial.map(({ file }) => file)).toEqual([
      "assets/entry.js",
      "assets/initial.css",
    ])
    expect(report.routes).toEqual([
      {
        label: "Articles",
        source: definitions.routes[0]?.source,
        assets: [
          {
            file: "assets/articles.js",
            raw: files.get("assets/articles.js")?.length,
            gzip: gzip(files.get("assets/articles.js")!),
          },
          {
            file: "assets/route-shared.js",
            raw: files.get("assets/route-shared.js")?.length,
            gzip: gzip(files.get("assets/route-shared.js")!),
          },
        ],
        gzip:
          gzip(files.get("assets/articles.js")!) +
          gzip(files.get("assets/route-shared.js")!),
      },
    ])
  })

  it("requires measured baselines and reasons for every budget", () => {
    expect(() =>
      validateBudgetDefinitions({ ...definitions, routes: [] })
    ).toThrow("At least one route bundle budget is required")
    expect(() =>
      validateBudgetDefinitions({
        ...definitions,
        routes: [{ ...definitions.routes[0]!, reason: "" }],
      })
    ).toThrow("Articles budget requires a reason")
  })

  it("fails closed when the production HTML exposes no initial assets", () => {
    expect(() =>
      createBundleReport(
        "<main>missing Vite entrypoints</main>",
        {},
        definitions.routes,
        () => Buffer.alloc(0)
      )
    ).toThrow("Production index.html contains no measurable initial assets")
  })

  it("reports baseline-to-current deltas and fails an exceeded budget", () => {
    const evaluations = evaluateBundleBudgets(
      {
        initial: [],
        initialGzip: 120,
        routes: [
          {
            label: "Articles",
            source: definitions.routes[0]!.source,
            assets: [],
            gzip: 80,
          },
        ],
      },
      definitions
    )

    expect(evaluations.map(({ status }) => status)).toEqual([
      "over-budget",
      "within-budget",
    ])
    expect(formatGithubSummary(evaluations)).toContain(
      "| Initial load | 0.0 kB | 0.1 kB | +0.1 kB | 0.1 kB | -0.0 kB | ❌ |"
    )
  })

  it("explains how to create dist when run without a production build", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bundle-budget-"))
    try {
      expect(() => collectBundleReport(directory, definitions)).toThrow(
        "Production bundle not found; run `pnpm --filter web build` first."
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})
