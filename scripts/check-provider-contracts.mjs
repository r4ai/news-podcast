import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const fixtureUrl = new URL(
  "../contracts/provider-contracts.json",
  import.meta.url
)
const raw = await readFile(fixtureUrl, "utf8")
const contract = JSON.parse(raw)

assert.equal(contract.voicevox.imageVersion, "24.04")
assert.equal(contract.voicevox.audioQueryOptionalFields.pauseLength, null)
assert.equal(contract.voicevox.audioQueryOptionalFields.pauseLengthScale, 1)
assert.equal(contract.voicevox.synthesis.riffWave, true)
assert.equal(contract.openai.requestsUsed, 12)
assert.equal(contract.openai.latestRefreshRequests, 10)
assert.equal(contract.openai.script.status, "completed")
assert.equal(contract.openai.script.consecutiveSamplesAfterFix, 5)
assert.equal(contract.openai.script.maximumOutputTokens, 4_096)
assert.equal(contract.openai.enrichment.status, "completed")
assert.equal(contract.openai.enrichment.consecutiveSamplesAfterFix, 5)
assert.equal(contract.openai.enrichment.maximumOutputTokens, 2_048)
assert.equal(
  contract.openai.enrichment.unsupportedKeywordRemoved,
  "uniqueItems"
)
assert.equal(contract.seaweedfs.bytesMatch, true)
assert.equal(contract.seaweedfs.cleaned, true)
assert.equal(contract.seaweedfs.missingStatus, 404)
assert.match(
  contract.feed.feedContentType,
  /(?:application|text)\/(?:rss\+xml|atom\+xml|xml)/i
)
assert.match(contract.feed.article.contentType, /^text\/html\b/i)

for (const forbidden of [
  /sk-[A-Za-z0-9_-]+/,
  /(?:access|secret)[_-]?key/i,
  /https?:\/\//i,
  /provider[_-]?id/i,
]) {
  assert.doesNotMatch(raw, forbidden)
}

console.log("provider contracts: fixture is redacted and internally consistent")
