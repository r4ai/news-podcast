import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

// ADR-0038: keep the public feature list within the production input boundary.
// Historical ADRs and legacy source readers may still mention Web search.
test("README capabilities describe selected archived articles without Web search", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8"
  )
  const capabilities = readme.match(
    /^## できること\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m
  )?.[1]
  assert.ok(capabilities, "README must retain its public capabilities section")
  assert.doesNotMatch(
    capabilities,
    /web[\s_-]*(?:検索|search)|ウェブ検索|外部検索/i
  )
  assert.match(
    capabilities,
    /選択[^\n]*保存[^\n]*記事|保存[^\n]*記事[^\n]*選択/
  )
})
