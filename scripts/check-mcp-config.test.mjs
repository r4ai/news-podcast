import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { validateMcpConfiguration } from "./check-mcp-config.mjs"

test("project Grafana MCP configuration matches the observed LGTM stack", () => {
  assert.doesNotThrow(() => validateMcpConfiguration())
})

test("Docker contexts exclude generated credentials and runtime artifacts", () => {
  const dockerignore = readFileSync(
    new URL("../.dockerignore", import.meta.url),
    "utf8"
  )
  assert.match(dockerignore, /^\.codex\/state\/$/m)
  assert.match(dockerignore, /^artifacts\/$/m)
})
