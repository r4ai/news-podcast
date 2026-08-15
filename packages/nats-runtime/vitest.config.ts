import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/sequential-rpc-loop.ts",
        "src/terminal-delivery-queue.ts",
        "src/transport.ts",
      ],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
})
