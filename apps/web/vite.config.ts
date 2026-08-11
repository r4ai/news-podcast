import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
      "/v1": apiTarget,
      "/openapi.json": apiTarget,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
