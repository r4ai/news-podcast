import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  EnrichmentProviderOutputSchema,
  type EnrichmentProviderInput,
  type EnrichmentProviderOutput,
} from "../../domain/enrichment.js"
import { providerFailure, type ProviderFailure } from "./failures.js"

/**
 * 応答の解釈。上流の自由形式を、必要な項目だけの検証済み出力へ落とし込む。
 */

const OutputTextSchema = Schema.Struct({
  type: Schema.Literal("output_text"),
  text: Schema.String,
})
const RefusalSchema = Schema.Struct({ type: Schema.Literal("refusal") })
const ResponseSchema = Schema.Struct({
  status: Schema.Literal("completed"),
  content: Schema.Array(Schema.Union([OutputTextSchema, RefusalSchema])),
  usage: Schema.Struct({
    input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
})
const parseResponse = parse(ResponseSchema)
const parseOutput = parse(EnrichmentProviderOutputSchema)

const REQUIRED_OUTPUT_KEYS = [
  "summary",
  "score",
  "reason",
  "tags",
  "suggestedTags",
] as const

// 過不足のないキー集合だけを受け入れる。既定値での穴埋めはしない。
const exactKeys = (value: unknown, expected: readonly string[]): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  )
}

/** Drops reasoning, annotations, refusal text, ids, and all other provider data. */
const projectResponse = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return value
  const record = value as Record<string, unknown>
  const content: unknown[] = []
  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (typeof item !== "object" || item === null) continue
      const parts = (item as Record<string, unknown>).content
      if (!Array.isArray(parts)) continue
      for (const part of parts) {
        if (typeof part !== "object" || part === null) continue
        const projected = part as Record<string, unknown>
        if (projected.type === "output_text") {
          content.push({ type: "output_text", text: projected.text })
        } else if (projected.type === "refusal") {
          content.push({ type: "refusal" })
        }
      }
    }
  }
  const usage =
    typeof record.usage === "object" && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : record.usage
  return {
    status: record.status,
    content,
    usage:
      typeof usage === "object" && usage !== null
        ? {
            input_tokens: (usage as Record<string, unknown>).input_tokens,
            output_tokens: (usage as Record<string, unknown>).output_tokens,
          }
        : usage,
  }
}

export const interpret = (
  value: unknown,
  input: EnrichmentProviderInput
): Effect.Effect<EnrichmentProviderOutput, ProviderFailure> =>
  parseResponse(projectResponse(value)).pipe(
    Effect.mapError(() => providerFailure({ _tag: "Malformed" })),
    Effect.flatMap((response) => {
      if (response.content.some((part) => part.type === "refusal")) {
        return Effect.fail(providerFailure({ _tag: "Refusal" }))
      }
      const text = response.content.find(
        (part) => part.type === "output_text"
      )?.text
      if (text === undefined)
        return Effect.fail(providerFailure({ _tag: "Malformed" }))
      return Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => providerFailure({ _tag: "Malformed" }),
      }).pipe(
        Effect.filterOrFail(
          (payload) => exactKeys(payload, REQUIRED_OUTPUT_KEYS),
          () => providerFailure({ _tag: "Malformed" })
        ),
        Effect.flatMap((payload) =>
          parseOutput({
            ...(payload as Record<string, unknown>),
            tokensIn: response.usage.input_tokens,
            tokensOut: response.usage.output_tokens,
          })
        ),
        Effect.mapError(() => providerFailure({ _tag: "Malformed" })),
        // 語彙外のタグを1つでも返してきた応答は、丸ごと不正として扱う。
        Effect.filterOrFail(
          (output) =>
            output.tags.every((tag) => input.tagVocabulary.includes(tag)),
          () => providerFailure({ _tag: "Malformed" })
        ),
        Effect.map(deepFreeze)
      )
    })
  )
