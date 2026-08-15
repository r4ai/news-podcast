import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

import { reactCompiler } from "./react-compiler"

// Storybookのaddon-vitestとは別に、hookと純関数だけをjsdomで実行する。
// route treeを再生成しないよう vite.config.ts は共有しない。
export default defineConfig({
  // テストもCompiler適用後のコードを検証する。
  plugins: [react(), reactCompiler()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    // 既定の http://localhost:4000 は開発APIと同じoriginなので、
    // 取りこぼしたfetchが実サーバへ届かないよう別originにする。
    environmentOptions: { jsdom: { url: "http://web.test/" } },
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/shared/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
})
