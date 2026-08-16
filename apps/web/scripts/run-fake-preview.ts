/**
 * 本番ビルドを`vite preview`で配り、APIは偽Gatewayへ向ける。
 *
 * `run-fake-stack.ts`のdev serverでは、変換とHMR clientの分だけ
 * FCP/LCPが実態から離れる。パフォーマンス計測はここが唯一の起点になる。
 */
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { build, preview } from "vite"

import { createFakeApi } from "./fake-api"

const apiPort = Number(process.env.PERF_API_PORT ?? 4100)
const webPort = Number(process.env.PERF_WEB_PORT ?? 4473)
const configFile = fileURLToPath(new URL("../vite.config.ts", import.meta.url))
const root = fileURLToPath(new URL("..", import.meta.url))

const fakeApi = createFakeApi()
const apiServer = serve({ fetch: fakeApi.fetch, port: apiPort })
// vite.config.tsはこの環境変数を読んでproxy先を決める。preview()が設定を
// 読み直すので、ここで先に決めておけばdev/previewで同じ経路になる。
process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`

// 計測対象は常に作りたてのバンドル。古いdistを測ると結論が嘘になる。
if (process.env.PERF_SKIP_BUILD !== "1") {
  await build({ configFile, root, logLevel: "warn" })
}

const server = await preview({
  configFile,
  root,
  preview: { host: "127.0.0.1", port: webPort, strictPort: true },
})

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  await server.close()
  await new Promise<void>((resolve) => apiServer.close(() => resolve()))
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(0)))
}
await new Promise(() => {})
