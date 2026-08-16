import { randomBytes } from "node:crypto"
import { chmodSync, lstatSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const defaultTargetPath = fileURLToPath(new URL("../.env", import.meta.url))
const defaultTemplatePath = fileURLToPath(
  new URL("../.env.example", import.meta.url)
)

const secret = () => randomBytes(32).toString("base64url")

export function createEnvironmentFile({
  targetPath = defaultTargetPath,
  templatePath = defaultTemplatePath,
} = {}) {
  try {
    const metadata = lstatSync(targetPath)
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error(
        "Refusing to secure an environment path that is not a regular file"
      )
    chmodSync(targetPath, 0o600)
    return "secured"
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error
  }

  const content = readFileSync(templatePath, "utf8")
    .replace(/^BETTER_AUTH_SECRET=$/m, `BETTER_AUTH_SECRET=${secret()}`)
    .replace(/^DEV_AUTH_PASSWORD=$/m, `DEV_AUTH_PASSWORD=${secret()}`)
    .replace(/^TELEMETRY_PROXY_TOKEN=$/m, `TELEMETRY_PROXY_TOKEN=${secret()}`)
    .replace(/^GRAFANA_ADMIN_PASSWORD=$/m, `GRAFANA_ADMIN_PASSWORD=${secret()}`)

  writeFileSync(targetPath, content, { flag: "wx", mode: 0o600 })
  chmodSync(targetPath, 0o600)
  return "created"
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const result = createEnvironmentFile()
  console.log(
    result === "created"
      ? "Created .env with local-only secrets. Add OPENAI_API_KEY and set PROVIDER_MODE=live for a live smoke test."
      : ".env already exists; permissions were secured and no values were changed."
  )
}
