import { mergeConfig } from "vite"
import { defineConfig } from "vitest/config"

import baseConfig from "./vitest.config"

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        "src/shared/markdown/markdown.test.tsx",
        "src/shared/markdown/lib/**/*.test.ts",
        "src/shared/markdown/pipeline/remark-embed-directive.test.ts",
      ],
      coverage: {
        enabled: true,
        provider: "v8",
        reporter: ["text", "json-summary"],
        include: [
          "src/shared/markdown/lib/callout.ts",
          "src/shared/markdown/lib/embed.ts",
          "src/shared/markdown/lib/line-ranges.ts",
          "src/shared/markdown/pipeline/remark-embed-directive.ts",
        ],
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  })
)
