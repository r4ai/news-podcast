import { defineConfig } from "@playwright/test"

const apiPort = process.env.E2E_API_PORT ?? "3310"
const webPort = process.env.E2E_WEB_PORT ?? "4273"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: {
    command: "./node_modules/.bin/tsx scripts/run-fake-stack.ts",
    env: { E2E_API_PORT: apiPort, E2E_WEB_PORT: webPort },
    url: `http://127.0.0.1:${webPort}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
