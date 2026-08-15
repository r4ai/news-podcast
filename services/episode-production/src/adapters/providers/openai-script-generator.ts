import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  retryProvider,
  type ProviderRetryRuntime,
} from "../../application/retry-provider.js"
import type {
  GeneratedScript,
  ScriptGenerationRequest,
  ScriptGenerator,
} from "../../application/ports/script-generator.js"
import type {
  ProviderFailure,
  ProviderRetryPolicy,
} from "../../domain/provider-reliability.js"

const MAXIMUM_TITLE_CHARACTERS = 200
const MAXIMUM_SCRIPT_CHARACTERS = 6_000
const MAXIMUM_SOURCE_COUNT = 20
const MAXIMUM_RESPONSE_BYTES = 1_048_576
const MAXIMUM_OUTPUT_TOKENS = 4_096
const MAXIMUM_SOURCE_MARKDOWN_CHARACTERS = 6_000

const OutputTextSchema = Schema.Struct({
  type: Schema.Literal("output_text"),
  text: Schema.String,
})
const RefusalSchema = Schema.Struct({ type: Schema.Literal("refusal") })
const CompletedResponseSchema = Schema.Struct({
  status: Schema.Literal("completed"),
  content: Schema.Array(Schema.Union([OutputTextSchema, RefusalSchema])),
})
const parseCompletedResponse = parse(CompletedResponseSchema)

const ScriptPayloadSchema = Schema.Struct({
  title: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAXIMUM_TITLE_CHARACTERS)
  ),
  script: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAXIMUM_SCRIPT_CHARACTERS)
  ),
  source_urls: Schema.NonEmptyArray(
    Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/i))
  ).check(Schema.isMaxLength(MAXIMUM_SOURCE_COUNT)),
})
const parseScriptPayload = parse(ScriptPayloadSchema)

export type OpenAiScriptGeneratorConfig = Readonly<{
  readonly endpoint: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
  readonly retryPolicy: ProviderRetryPolicy
}>

export type OpenAiScriptGeneratorDependencies = Readonly<{
  readonly fetcher?: typeof fetch
  readonly retryRuntime?: ProviderRetryRuntime
}>

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null

const isProviderFailure = (value: unknown): value is ProviderFailure =>
  isRecord(value) &&
  (value._tag === "HttpFailure" ||
    value._tag === "Timeout" ||
    value._tag === "TransportFailure" ||
    value._tag === "Incomplete" ||
    value._tag === "MalformedResponse" ||
    value._tag === "Refusal" ||
    value._tag === "Canceled")

const failure = <Failure extends ProviderFailure>(value: Failure): Failure =>
  Object.freeze(value)

/** Keeps only a syntactically valid Retry-After value, never an error body. */
const readRetryAfter = (response: Response): string | undefined => {
  const value = response.headers.get("retry-after")?.trim()
  if (!value || value.length > 64) return undefined
  return /^\d+$/.test(value) || /^[A-Za-z]{3}, .+ GMT$/.test(value)
    ? value
    : undefined
}

const requestBody = (
  config: OpenAiScriptGeneratorConfig,
  request: ScriptGenerationRequest
): UnknownRecord => ({
  model: config.model,
  max_output_tokens: MAXIMUM_OUTPUT_TOKENS,
  input: [
    {
      role: "system",
      content:
        "提供された記事だけを根拠に、日本語ニュースPodcastのタイトルと台本を作成してください。source_urlsには実際に使用した入力URLだけを含めてください。",
    },
    {
      role: "user",
      content: JSON.stringify({
        sources: request.sources.map((source) => ({
          ...source,
          markdown: Array.from(source.markdown)
            .slice(0, MAXIMUM_SOURCE_MARKDOWN_CHARACTERS)
            .join(""),
        })),
      }),
    },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "episode_script_v1",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "script", "source_urls"],
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: MAXIMUM_TITLE_CHARACTERS,
          },
          script: {
            type: "string",
            minLength: 1,
            maxLength: MAXIMUM_SCRIPT_CHARACTERS,
          },
          source_urls: {
            type: "array",
            minItems: 1,
            maxItems: MAXIMUM_SOURCE_COUNT,
            items: { type: "string" },
          },
        },
      },
    },
  },
})

const malformed = () => failure({ _tag: "MalformedResponse" })

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase()
  if (!contentType?.startsWith("application/json")) throw malformed()
  const declared = response.headers.get("content-length")
  if (declared !== null) {
    const length = Number(declared)
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAXIMUM_RESPONSE_BYTES
    )
      throw malformed()
  }
  const reader = response.body?.getReader()
  if (!reader) throw malformed()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel()
      throw malformed()
    }
    chunks.push(result.value)
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
    throw malformed()
  }
}

const fetchResponse = (
  config: OpenAiScriptGeneratorConfig,
  request: ScriptGenerationRequest,
  fetcher: typeof fetch
): Effect.Effect<unknown, ProviderFailure> =>
  Effect.tryPromise({
    try: async (effectSignal) => {
      const timeout = new AbortController()
      const timer = setTimeout(
        () => timeout.abort(),
        config.requestTimeoutMillis
      )
      timer.unref()
      const signal = AbortSignal.any([
        effectSignal,
        timeout.signal,
        ...(request.signal ? [request.signal] : []),
      ])
      try {
        const response = await fetcher(config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody(config, request)),
          signal,
        })
        if (!response.ok) {
          const retryAfter = readRetryAfter(response)
          throw failure({
            _tag: "HttpFailure",
            status: response.status,
            ...(retryAfter ? { retryAfter } : {}),
          })
        }
        return await readBoundedJson(response)
      } catch (error) {
        if (isProviderFailure(error)) throw error
        if (request.signal?.aborted) {
          throw failure({ _tag: "Canceled" })
        }
        if (timeout.signal.aborted) {
          throw failure({ _tag: "Timeout" })
        }
        if (effectSignal.aborted) {
          throw failure({ _tag: "Canceled" })
        }
        throw failure({ _tag: "TransportFailure" })
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (error) =>
      isProviderFailure(error) ? error : failure({ _tag: "TransportFailure" }),
  })

/**
 * Projects mutable provider output onto the complete response contract.
 * Provider-only fields and refusal text are discarded before parsing.
 */
const projectCompletedResponse = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  const output = value.output
  const content: unknown[] = []
  if (!Array.isArray(output)) {
    return { status: value.status, content: output }
  }
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part)) {
        content.push(part)
      } else if (part.type === "output_text") {
        content.push({ type: part.type, text: part.text })
      } else if (part.type === "refusal") {
        content.push({ type: part.type })
      } else {
        content.push({ type: part.type })
      }
    }
  }
  return { status: value.status, content }
}

const interpretResponse = (
  value: unknown,
  request: ScriptGenerationRequest
): Effect.Effect<GeneratedScript, ProviderFailure> => {
  if (isRecord(value) && value.status === "incomplete") {
    return Effect.fail(failure({ _tag: "Incomplete" }))
  }
  return parseCompletedResponse(projectCompletedResponse(value)).pipe(
    Effect.mapError(() => failure({ _tag: "MalformedResponse" })),
    Effect.flatMap(
      (response): Effect.Effect<GeneratedScript, ProviderFailure> => {
        if (response.content.some((part) => part.type === "refusal")) {
          return Effect.fail(failure({ _tag: "Refusal" }))
        }
        const outputText = response.content.find(
          (part) => part.type === "output_text"
        )?.text
        if (outputText === undefined) {
          return Effect.fail(failure({ _tag: "MalformedResponse" }))
        }
        return Effect.try({
          try: (): unknown => JSON.parse(outputText),
          catch: () => failure({ _tag: "MalformedResponse" }),
        }).pipe(
          Effect.flatMap(parseScriptPayload),
          Effect.mapError(() => failure({ _tag: "MalformedResponse" })),
          Effect.flatMap(
            (payload): Effect.Effect<GeneratedScript, ProviderFailure> => {
              const allowed = new Set(
                request.sources.map((source) => source.url)
              )
              const uniqueSources = new Set(payload.source_urls)
              if (
                uniqueSources.size !== payload.source_urls.length ||
                payload.source_urls.some((url) => !allowed.has(url))
              ) {
                return Effect.fail(failure({ _tag: "MalformedResponse" }))
              }
              return Effect.succeed(
                deepFreeze({
                  title: payload.title,
                  script: payload.script,
                  sourceUrls: payload.source_urls,
                })
              )
            }
          )
        )
      }
    )
  )
}

const failWhenAborted = (
  signal: AbortSignal
): Effect.Effect<never, ProviderFailure> =>
  Effect.callback<never, ProviderFailure>((resume) => {
    const abort = () => resume(Effect.fail(failure({ _tag: "Canceled" })))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })

export const makeOpenAiScriptGenerator = (
  config: OpenAiScriptGeneratorConfig,
  dependencies: OpenAiScriptGeneratorDependencies = {}
): ScriptGenerator => {
  const fetcher = dependencies.fetcher ?? fetch
  const generate: ScriptGenerator["generate"] = (request) => {
    const operation = () =>
      fetchResponse(config, request, fetcher).pipe(
        Effect.flatMap((response) => interpretResponse(response, request))
      )
    const retried = dependencies.retryRuntime
      ? retryProvider(operation, config.retryPolicy, dependencies.retryRuntime)
      : retryProvider(operation, config.retryPolicy)
    return request.signal
      ? Effect.raceFirst(retried, failWhenAborted(request.signal))
      : retried
  }
  return deepFreeze({ generate })
}
