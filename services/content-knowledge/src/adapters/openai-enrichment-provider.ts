import { deepFreeze, parse } from "@news-podcast/kernel"
import { Clock, Effect, Schema } from "effect"

import type {
  EnrichmentProvider,
  EnrichmentProviderError,
} from "../application/enrichment.js"
import {
  EnrichmentProviderInputSchema,
  EnrichmentProviderOutputSchema,
  type EnrichmentProviderInput,
  type EnrichmentProviderOutput,
} from "../domain/enrichment.js"

const MAXIMUM_RESPONSE_BYTES = 1_048_576

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
const parseInput = parse(EnrichmentProviderInputSchema)
const parseResponse = parse(ResponseSchema)
const parseOutput = parse(EnrichmentProviderOutputSchema)

export type OpenAiEnrichmentProviderConfig = Readonly<{
  readonly endpoint: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly maximumAttempts: number
  readonly baseDelayMillis: number
  readonly maximumDelayMillis: number
}>

export type OpenAiEnrichmentProviderDependencies = Readonly<{
  readonly fetcher?: typeof fetch
  readonly nowMillis?: () => Effect.Effect<number>
  readonly sleep?: (milliseconds: number) => Effect.Effect<void>
}>

type ProviderFailure = Readonly<
  | {
      readonly _tag: "Http"
      readonly status: number
      readonly retryAfter?: string
    }
  | { readonly _tag: "Timeout" }
  | { readonly _tag: "Transport" }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "Refusal" }
>

const providerFailure = (value: ProviderFailure): ProviderFailure =>
  Object.freeze(value)

const applicationFailure = (
  reason: EnrichmentProviderError["reason"],
  message: string
): EnrichmentProviderError =>
  deepFreeze({ _tag: "EnrichmentProviderFailed", reason, message })

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

const responseFormat = {
  type: "json_schema",
  name: "article_enrichment_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "score", "reason", "tags", "suggestedTags"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 2_000 },
      score: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string", minLength: 1, maxLength: 1_000 },
      tags: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: { type: "string" },
      },
      suggestedTags: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: { type: "string" },
      },
    },
  },
} as const

const requestBody = (
  config: OpenAiEnrichmentProviderConfig,
  input: EnrichmentProviderInput
) => ({
  model: config.model,
  input: [
    {
      role: "system",
      content:
        "記事本文だけを根拠に要約と関心度を評価してください。tagsにはtagVocabulary内の値だけを使い、新規候補はsuggestedTagsへ入れてください。",
    },
    {
      role: "user",
      content: JSON.stringify({
        articleId: input.articleId,
        title: input.title,
        markdown: input.markdown,
        interestProfile: input.interestProfile,
        tagVocabulary: input.tagVocabulary,
      }),
    },
  ],
  text: { format: responseFormat },
})

const retryAfter = (response: Response): string | undefined => {
  const value = response.headers.get("retry-after")?.trim()
  if (!value || value.length > 64) return undefined
  return /^\d+$/.test(value) ||
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value
    )
    ? value
    : undefined
}

const readBoundedJson = async (response: Response): Promise<unknown> => {
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw providerFailure({ _tag: "Malformed" })
  }
  const declared = response.headers.get("content-length")
  if (declared !== null && Number(declared) > MAXIMUM_RESPONSE_BYTES) {
    throw providerFailure({ _tag: "Malformed" })
  }
  const reader = response.body?.getReader()
  if (!reader) throw providerFailure({ _tag: "Malformed" })
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel()
      throw providerFailure({ _tag: "Malformed" })
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown
  } catch {
    throw providerFailure({ _tag: "Malformed" })
  }
}

const isProviderFailure = (value: unknown): value is ProviderFailure =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  ["Http", "Timeout", "Transport", "Malformed", "Refusal"].includes(
    String((value as { _tag: unknown })._tag)
  )

const fetchResponse = (
  config: OpenAiEnrichmentProviderConfig,
  input: EnrichmentProviderInput,
  fetcher: typeof fetch
): Effect.Effect<unknown, ProviderFailure> =>
  Effect.tryPromise({
    try: async (effectSignal) => {
      const deadline = new AbortController()
      const timer = setTimeout(
        () => deadline.abort(),
        config.requestTimeoutMillis
      )
      timer.unref()
      try {
        const response = await fetcher(config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody(config, input)),
          signal: AbortSignal.any([effectSignal, deadline.signal]),
        })
        if (!response.ok) {
          const header = retryAfter(response)
          throw providerFailure({
            _tag: "Http",
            status: response.status,
            ...(header ? { retryAfter: header } : {}),
          })
        }
        return await readBoundedJson(response)
      } catch (error) {
        if (isProviderFailure(error)) throw error
        if (deadline.signal.aborted) throw providerFailure({ _tag: "Timeout" })
        throw providerFailure({ _tag: "Transport" })
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (error) =>
      isProviderFailure(error) ? error : providerFailure({ _tag: "Transport" }),
  })

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

const interpret = (
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
          (payload) =>
            exactKeys(payload, [
              "summary",
              "score",
              "reason",
              "tags",
              "suggestedTags",
            ]),
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
        Effect.filterOrFail(
          (output) =>
            output.tags.every((tag) => input.tagVocabulary.includes(tag)),
          () => providerFailure({ _tag: "Malformed" })
        ),
        Effect.map(deepFreeze)
      )
    })
  )

const retryDelay = (
  failure: ProviderFailure,
  attempt: number,
  nowMillis: number,
  config: OpenAiEnrichmentProviderConfig
): number | undefined => {
  const retryable =
    failure._tag === "Timeout" ||
    (failure._tag === "Http" &&
      (failure.status === 429 ||
        (failure.status >= 500 && failure.status <= 599)))
  if (!retryable || attempt >= config.maximumAttempts) return undefined
  if (failure._tag === "Http" && failure.retryAfter) {
    const delay = /^\d+$/.test(failure.retryAfter)
      ? Number(failure.retryAfter) * 1_000
      : Math.max(0, Date.parse(failure.retryAfter) - nowMillis)
    return Number.isSafeInteger(delay) && delay <= config.maximumDelayMillis
      ? delay
      : undefined
  }
  return Math.min(
    config.baseDelayMillis * 2 ** (attempt - 1),
    config.maximumDelayMillis
  )
}

const publicFailure = (failure: ProviderFailure): EnrichmentProviderError => {
  if (failure._tag === "Timeout") {
    return applicationFailure(
      "Retryable",
      "enrichment provider request timed out"
    )
  }
  if (failure._tag === "Http" && failure.status === 429) {
    return applicationFailure("RateLimited", "enrichment provider rate limited")
  }
  if (
    failure._tag === "Http" &&
    failure.status >= 500 &&
    failure.status <= 599
  ) {
    return applicationFailure("Retryable", "enrichment provider unavailable")
  }
  if (failure._tag === "Http") {
    return applicationFailure(
      "Permanent",
      "enrichment provider rejected request"
    )
  }
  if (failure._tag === "Transport") {
    return applicationFailure(
      "Permanent",
      "enrichment provider transport failed"
    )
  }
  if (failure._tag === "Refusal") {
    return applicationFailure(
      "Permanent",
      "enrichment provider refused request"
    )
  }
  return applicationFailure("Permanent", "invalid enrichment provider response")
}

export const makeOpenAiEnrichmentProvider = (
  config: OpenAiEnrichmentProviderConfig,
  dependencies: OpenAiEnrichmentProviderDependencies = {}
): EnrichmentProvider => {
  const fetcher = dependencies.fetcher ?? fetch
  const nowMillis = dependencies.nowMillis ?? (() => Clock.currentTimeMillis)
  const sleep =
    dependencies.sleep ?? ((milliseconds) => Effect.sleep(milliseconds))

  return deepFreeze({
    enrich: (unknownInput) =>
      parseInput(unknownInput).pipe(
        Effect.mapError(() =>
          applicationFailure("Permanent", "invalid enrichment provider input")
        ),
        Effect.flatMap((input) => {
          const attempt = (
            number: number
          ): Effect.Effect<EnrichmentProviderOutput, EnrichmentProviderError> =>
            fetchResponse(config, input, fetcher).pipe(
              Effect.flatMap((response) => interpret(response, input)),
              Effect.matchEffect({
                onFailure: (failure) =>
                  nowMillis().pipe(
                    Effect.flatMap((now) => {
                      const delay = retryDelay(failure, number, now, config)
                      return delay === undefined
                        ? Effect.fail(publicFailure(failure))
                        : sleep(delay).pipe(Effect.andThen(attempt(number + 1)))
                    })
                  ),
                onSuccess: Effect.succeed,
              })
            )
          return attempt(1)
        })
      ),
  })
}
