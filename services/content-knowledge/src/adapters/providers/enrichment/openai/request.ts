import { Effect } from "effect"

import type { EnrichmentProviderInput } from "../../../../domain/enrichment.js"
import type { OpenAiEnrichmentProviderConfig } from "./config.js"
import {
  isProviderFailure,
  providerFailure,
  readRetryAfter,
  type ProviderFailure,
} from "./failures.js"

/**
 * 補完リクエストの組み立てと送信。応答は上限付きでしか読み取らない。
 */

const MAXIMUM_RESPONSE_BYTES = 1_048_576

// 構造化出力を厳密モードで要求し、余計なキーの混入を上流側でも防ぐ。
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

export const fetchResponse = (
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
          const header = readRetryAfter(response)
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
