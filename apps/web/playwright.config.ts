import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/visual",
  use: { baseURL: "http://127.0.0.1:6006" },
  webServer: {
    command: "pnpm storybook --ci --no-open",
    url: "http://127.0.0.1:6006",
    reuseExistingServer: true,
  },
})
