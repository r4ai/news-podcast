import { defineConfig } from "@playwright/test"

const apiPort = process.env.PERF_API_PORT ?? "4100"
const webPort = process.env.PERF_WEB_PORT ?? "4473"

/**
 * パフォーマンス計測は本番ビルドに対してだけ行う (scripts/run-fake-preview.ts)。
 * 並列に走らせるとCPU抑制の意味が無くなるので、必ず1本ずつ。
 */
export default defineConfig({
  testDir: "./tests/perf",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: {
    command: "./node_modules/.bin/tsx scripts/run-fake-preview.ts",
    env: { PERF_API_PORT: apiPort, PERF_WEB_PORT: webPort },
    url: `http://127.0.0.1:${webPort}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
