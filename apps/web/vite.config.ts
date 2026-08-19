import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

import { reactCompiler } from "./react-compiler"

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000"

const apiProxy = {
  "/api": apiTarget,
  "/health": apiTarget,
  "/v1": apiTarget,
  "/docs": apiTarget,
  "/openapi.json": apiTarget,
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    // Bundle budgets resolve source routes to hashed output chunks through this
    // deterministic build artifact. Browser entrypoints do not reference it.
    manifest: true,
  },
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    reactCompiler(),
    tailwindcss(),
  ],
  server: {
    allowedHosts: ["web"],
    host: "0.0.0.0",
    port: 4173,
    proxy: apiProxy,
  },
  // 本番ビルドの実測 (scripts/run-fake-preview.ts) はdev serverではなく
  // previewで行う。devのままでは変換とHMRの分だけFCP/LCPが実態から離れる。
  preview: {
    allowedHosts: ["web"],
    host: "127.0.0.1",
    port: 4473,
    proxy: apiProxy,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
