import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "tsx scripts/run-fake-stack.ts",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
