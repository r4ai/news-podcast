import { defineConfig } from "@playwright/test"

/** Explicit opt-in smoke against the already running production-shaped stack. */
export default defineConfig({
  testDir: "./tests/live",
  timeout: 8 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: process.env.LIVE_STACK_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
})
