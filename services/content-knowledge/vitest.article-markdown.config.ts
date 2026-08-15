import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "src/infrastructure/unsafe/article-markdown/**/*.test.ts",
      "src/infrastructure/unsafe/article-markdown-parser.test.ts",
      "src/infrastructure/unsafe/http-s3-article-capture.test.ts",
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/infrastructure/unsafe/article-markdown/**/*.ts"],
      exclude: [
        "src/infrastructure/unsafe/article-markdown/**/*.test.ts",
        "src/infrastructure/unsafe/article-markdown/**/contracts.ts",
        "src/infrastructure/unsafe/article-markdown/index.ts",
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
