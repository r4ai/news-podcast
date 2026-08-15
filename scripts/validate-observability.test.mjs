import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(
  new URL("./validate-observability.sh", import.meta.url)
)
const script = await readFile(scriptPath, "utf8")

assert.doesNotMatch(
  script,
  /(^|\s)rg(?:\s|$)/m,
  "observability validation must use tools available on GitHub-hosted runners"
)
assert.match(script, /grep -Pzo/)
