import assert from "node:assert/strict"

assert.equal(
  process.env.PROVIDER_CONTRACT_REFRESH,
  "1",
  "Set PROVIDER_CONTRACT_REFRESH=1 for the explicit live refresh"
)

const required = [
  "OPENAI_API_KEY",
  "VOICEVOX_BASE_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "PROVIDER_CONTRACT_FEED_URL",
]
const missing = required.filter((name) => !process.env[name]?.trim())
assert.deepEqual(
  missing,
  [],
  `Missing refresh configuration: ${missing.join(", ")}`
)

console.log(
  "Live refresh is intentionally evidence-only: run the bounded OpenAI contract tests (OPENAI_CONTRACT_SAMPLES defaults to 3 and is capped at 25 per adapter), VOICEVOX OpenAPI/WAV probe, SeaweedFS temporary-prefix round trip, and safe-fetch feed probe documented in docs/external-provider-contracts.md; redact the resulting structure before updating contracts/provider-contracts.json."
)
