import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate:
    "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  workers: 1,
  projects: [
    {
      name: "storybook",
      testMatch: "**/foundation.spec.ts",
      use: { baseURL: "http://127.0.0.1:6006" },
    },
    {
      name: "app",
      testMatch: "**/app-pages.spec.ts",
      use: { baseURL: "http://127.0.0.1:4373" },
    },
  ],
  webServer: [
    {
      command: "pnpm storybook --ci --no-open",
      url: "http://127.0.0.1:6006",
      reuseExistingServer: true,
    },
    {
      command: "tsx scripts/run-fake-stack.ts",
      env: { E2E_API_PORT: "3200", E2E_WEB_PORT: "4373" },
      url: "http://127.0.0.1:4373/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
