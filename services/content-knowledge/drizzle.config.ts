import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  // 生成のみに使う。適用は起動時のマイグレータが行う。
  dbCredentials: { url: "file:./.drizzle-generate.sqlite" },
})
