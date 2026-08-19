export type BundleBudgetDefinition = {
  readonly label: string
  readonly baselineGzip: number
  readonly budgetGzip: number
  readonly reason: string
}

export type RouteBundleBudgetDefinition = BundleBudgetDefinition & {
  readonly source: string
}

export type BundleBudgetDefinitions = {
  readonly initial: BundleBudgetDefinition
  readonly routes: readonly RouteBundleBudgetDefinition[]
}

const kib = (value: number) => Math.round(value * 1024)

/**
 * A budget change must keep its measured baseline and rationale in the same diff.
 * CI prints baseline -> current -> budget so reviewers can assess that decision.
 */
export const bundleBudgetDefinitions = {
  initial: {
    label: "Initial load",
    baselineGzip: kib(223.7),
    budgetGzip: kib(256),
    reason:
      "2026-08-20: accepted UI work including the Base UI migration moved the measured initial payload from 223.7 to 244.6 kB (+20.9 kB); raise 240 to 256 kB while route budgets isolate subsequent growth.",
  },
  routes: [
    {
      label: "Dashboard route",
      source: "src/routes/_authenticated/index.tsx?tsr-split=component",
      baselineGzip: 43_079,
      budgetGzip: kib(48),
      reason:
        "2026-08-20: introduce the route gate from a measured 42.1 kB static payload with 5.9 kB headroom.",
    },
    {
      label: "Articles route",
      source:
        "src/routes/_authenticated/articles/index.tsx?tsr-split=component",
      baselineGzip: 78_015,
      budgetGzip: kib(84),
      reason:
        "2026-08-20: introduce the route gate from a measured 76.2 kB static payload with 7.8 kB headroom.",
    },
    {
      label: "Library route",
      source: "src/routes/_authenticated/library/index.tsx?tsr-split=component",
      baselineGzip: 11_506,
      budgetGzip: kib(16),
      reason:
        "2026-08-20: introduce the route gate from a measured 11.2 kB static payload with 4.8 kB headroom.",
    },
    {
      label: "Subscriptions route",
      source:
        "src/routes/_authenticated/subscriptions/index.tsx?tsr-split=component",
      baselineGzip: 34_969,
      budgetGzip: kib(40),
      reason:
        "2026-08-20: introduce the route gate from a measured 34.1 kB static payload with 5.9 kB headroom.",
    },
    {
      label: "Schedule route",
      source:
        "src/routes/_authenticated/schedule/index.tsx?tsr-split=component",
      baselineGzip: 24_482,
      budgetGzip: kib(30),
      reason:
        "2026-08-20: introduce the route gate from a measured 23.9 kB static payload with 6.1 kB headroom.",
    },
    {
      label: "Settings route",
      source:
        "src/routes/_authenticated/settings/index.tsx?tsr-split=component",
      baselineGzip: 32_087,
      budgetGzip: kib(38),
      reason:
        "2026-08-20: introduce the route gate from a measured 31.3 kB static payload with 6.7 kB headroom.",
    },
  ],
} as const satisfies BundleBudgetDefinitions
