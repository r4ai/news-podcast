import assert from "node:assert/strict"
import test from "node:test"

import { validateMcpConfiguration } from "./check-mcp-config.mjs"

test("project Grafana MCP configuration matches the observed LGTM stack", () => {
  assert.doesNotThrow(() => validateMcpConfiguration())
})
