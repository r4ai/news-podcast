import { Schema } from "effect"

export const ScriptQualityReasonCodeSchema = Schema.Literals([
  "none",
  "prompt_injection",
  "unsupported_claim",
  "source_spoofing",
  "interest_override",
])

export type ScriptQualityReasonCode = typeof ScriptQualityReasonCodeSchema.Type

export const ScriptQualityPayloadSchema = Schema.Struct({
  verdict: Schema.Literals(["pass", "reject"]),
  reason_code: ScriptQualityReasonCodeSchema,
})
