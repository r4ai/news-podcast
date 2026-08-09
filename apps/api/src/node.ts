import { serve } from "@hono/node-server"
import { createLocalAuth } from "@news-podcast/adapters/auth/local"
import { readLocalAuthConfig } from "@news-podcast/adapters/config"

import { createApp } from "./app.js"

const auth = createLocalAuth(readLocalAuthConfig(process.env))
const app = createApp({ authHandler: auth.handler })

serve({ fetch: app.fetch, port: 3000 }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`)
})
