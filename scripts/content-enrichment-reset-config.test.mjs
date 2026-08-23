import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const compose = await readFile(
  new URL("../compose.yaml", import.meta.url),
  "utf8"
)

test("Compose preserves explicit non-production enrichment reset opt-in", () => {
  assert.match(
    compose,
    /CONTENT_ENRICH_RESET_ENABLED:\s*"\$\{CONTENT_ENRICH_RESET_ENABLED:-false\}"/
  )
  assert.doesNotMatch(compose, /CONTENT_ENRICH_RESET_ENABLED:\s*"false"/)
})
