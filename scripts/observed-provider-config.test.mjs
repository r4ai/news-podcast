import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const observedCompose = readFileSync(
  new URL("../compose.observability.yaml", import.meta.url),
  "utf8"
)

const episodeProductionBlock = observedCompose.match(
  /^  episode-production:\n([\s\S]*?)(?=^  [a-z][a-z-]+:|^networks:)/m
)?.[0]

test("observed stack inherits live-provider configuration from the application environment", () => {
  assert.ok(episodeProductionBlock, "episode-production override must exist")
  assert.match(episodeProductionBlock, /<<: \*context-otel/)
  assert.doesNotMatch(episodeProductionBlock, /^\s+PROVIDER_MODE:/m)
  assert.doesNotMatch(episodeProductionBlock, /^\s+OPENAI_API_KEY:/m)
})
