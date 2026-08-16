import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { createServer } from "vite"

import { createFakeApi } from "./fake-api"

const apiPort = Number(process.env.E2E_API_PORT ?? 4000)
const webPort = Number(process.env.E2E_WEB_PORT ?? 4173)

const fakeApi = createFakeApi()
const apiServer = serve({ fetch: fakeApi.fetch, port: apiPort })
process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`
const vite = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: webPort },
})
await vite.listen()

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  await vite.close()
  await new Promise<void>((resolve) => apiServer.close(() => resolve()))
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(0)))
}
await new Promise(() => {})
