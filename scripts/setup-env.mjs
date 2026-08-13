import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const target = new URL("../.env", import.meta.url)
if (existsSync(target)) {
  console.log(".env already exists; no values were changed.")
  process.exit(0)
}

const template = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8"
)
const secret = () => randomBytes(32).toString("base64url")
const content = template
  .replace(/^BETTER_AUTH_SECRET=$/m, `BETTER_AUTH_SECRET=${secret()}`)
  .replace(/^DEV_AUTH_PASSWORD=$/m, `DEV_AUTH_PASSWORD=${secret()}`)
  .replace(/^TELEMETRY_PROXY_TOKEN=$/m, `TELEMETRY_PROXY_TOKEN=${secret()}`)
  .replace(/^GRAFANA_ADMIN_PASSWORD=$/m, `GRAFANA_ADMIN_PASSWORD=${secret()}`)

writeFileSync(target, content, { flag: "wx" })
console.log(
  "Created .env with local-only secrets. Add OPENAI_API_KEY and set PROVIDER_MODE=live for a live smoke test."
)
