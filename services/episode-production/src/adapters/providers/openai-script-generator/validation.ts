import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  GeneratedScript,
  ScriptGenerationRequest,
} from "../../../application/ports/script-generator.js"
import type { ProviderFailure } from "../../../domain/provider-reliability.js"
import type { ScriptPayloadSchema } from "./schema.js"

export const validateGeneratedScript = (
  payload: typeof ScriptPayloadSchema.Type,
  request: ScriptGenerationRequest
): Effect.Effect<GeneratedScript, ProviderFailure> => {
  const allowed = new Map(
    request.sources.map((source, index) => [`source-${index + 1}`, source.url])
  )
  const uniqueSources = new Set(payload.source_ids)
  if (
    uniqueSources.size !== payload.source_ids.length ||
    payload.source_ids.some((id) => !allowed.has(id))
  ) {
    return Effect.fail(deepFreeze({ _tag: "MalformedResponse" as const }))
  }
  return Effect.succeed(
    deepFreeze({
      title: payload.title,
      script: payload.script,
      sourceUrls: payload.source_ids.map((id) => allowed.get(id)!),
    })
  )
}
