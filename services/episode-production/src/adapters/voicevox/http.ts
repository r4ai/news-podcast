import { Effect } from "effect"

import type { ProviderFailure } from "../../domain/provider-reliability.js"
import type { VoicevoxSpeechSynthesizerConfig } from "./config.js"

/**
 * 外部HTTPとの境界。応答本文を無制限に取り込まないこと、
 * そして中断・時間切れ・転送失敗を取り違えないことだけを引き受ける。
 */

const MAXIMUM_JSON_BYTES = 2 * 1_024 * 1_024

type UnknownRecord = Record<string, unknown>

export const isRecord = (value: unknown): value is UnknownRecord =>
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

export const failure = <Failure extends ProviderFailure>(
  value: Failure
): Failure => Object.freeze(value)

export const malformed = () => failure({ _tag: "MalformedResponse" })

/** Keeps bounded protocol metadata only; response bodies are never retained. */
const readRetryAfter = (response: Response): string | undefined => {
  const value = response.headers.get("retry-after")?.trim()
  if (!value || value.length > 64) return undefined
  return /^\d+$/.test(value) || /^[A-Za-z]{3}, .+ GMT$/.test(value)
    ? value
    : undefined
}

export const assertSuccessful = (response: Response): void => {
  if (response.ok) return
  const retryAfter = readRetryAfter(response)
  throw failure({
    _tag: "HttpFailure",
    status: response.status,
    ...(retryAfter ? { retryAfter } : {}),
  })
}

// 宣言されたサイズも実際に届いたサイズも上限で切る。超えた時点で読むのをやめる。
export const readBoundedBytes = async (
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> => {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maximumBytes
    ) {
      throw malformed()
    }
  }
  const reader = response.body?.getReader()
  if (!reader) throw malformed()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > maximumBytes) {
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
  return bytes
}

const readJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase()
  if (!contentType?.startsWith("application/json")) throw malformed()
  const bytes = await readBoundedBytes(response, MAXIMUM_JSON_BYTES)
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw malformed()
  }
}

// 呼び出し元の中断・締切・Effectの中断のいずれでも、確実に一つの失敗へ落とす。
export const requestWithDeadline = <Success>(
  config: VoicevoxSpeechSynthesizerConfig,
  externalSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<Success>
): Effect.Effect<Success, ProviderFailure> =>
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
        ...(externalSignal ? [externalSignal] : []),
      ])
      try {
        return await run(signal)
      } catch (error) {
        if (isProviderFailure(error)) throw error
        if (externalSignal?.aborted || effectSignal.aborted) {
          throw failure({ _tag: "Canceled" })
        }
        if (timeout.signal.aborted) throw failure({ _tag: "Timeout" })
        throw failure({ _tag: "TransportFailure" })
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (error) =>
      isProviderFailure(error) ? error : failure({ _tag: "TransportFailure" }),
  })

export const endpoint = (baseUrl: URL, path: string): URL => {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}${path}`
  url.search = ""
  url.hash = ""
  return url
}

export const fetchJson = (
  config: VoicevoxSpeechSynthesizerConfig,
  fetcher: typeof fetch,
  url: URL,
  init: RequestInit,
  externalSignal: AbortSignal | undefined
): Effect.Effect<unknown, ProviderFailure> =>
  requestWithDeadline(config, externalSignal, async (signal) => {
    const response = await fetcher(url, { ...init, signal })
    assertSuccessful(response)
    return readJson(response)
  })

export const failWhenAborted = (
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
