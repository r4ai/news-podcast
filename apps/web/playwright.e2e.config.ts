import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4273" },
  webServer: {
    command: "tsx scripts/run-fake-stack.ts",
    env: { E2E_API_PORT: "3100", E2E_WEB_PORT: "4273" },
    url: "http://127.0.0.1:4273/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
