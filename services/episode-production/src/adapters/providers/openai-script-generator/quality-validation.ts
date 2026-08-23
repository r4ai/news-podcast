import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ProviderFailure } from "../../../domain/provider-reliability.js"
import type { ScriptQualityPayloadSchema } from "./quality-schema.js"

export const validateScriptQuality = (
  payload: typeof ScriptQualityPayloadSchema.Type
): Effect.Effect<
  void,
  ProviderFailure | Readonly<{ readonly _tag: "QualityRejected" }>
> => {
  if (payload.verdict === "pass" && payload.reason_code === "none") {
    return Effect.void
  }
  if (payload.verdict === "reject" && payload.reason_code !== "none") {
    return Effect.fail(deepFreeze({ _tag: "QualityRejected" as const }))
  }
  return Effect.fail(deepFreeze({ _tag: "MalformedResponse" as const }))
}
