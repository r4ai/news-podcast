import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  retryProvider,
  type ProviderRetryRuntime,
} from "../application/retry-provider.js"
import type { SpeechSynthesizer } from "../application/speech-synthesizer.js"
import type {
  ProviderFailure,
  ProviderRetryPolicy,
} from "../domain/provider-reliability.js"

const MAXIMUM_JSON_BYTES = 2 * 1_024 * 1_024

const MoraSchema = Schema.Struct({
  text: Schema.String,
  consonant: Schema.NullOr(Schema.String),
  consonant_length: Schema.NullOr(Schema.Number),
  vowel: Schema.String,
  vowel_length: Schema.Number,
  pitch: Schema.Number,
})
const AccentPhraseSchema = Schema.Struct({
  moras: Schema.Array(MoraSchema),
  accent: Schema.Int,
  pause_mora: Schema.NullOr(MoraSchema),
  is_interrogative: Schema.Boolean,
})
const AudioQuerySchema = Schema.Struct({
  accent_phrases: Schema.Array(AccentPhraseSchema),
  speedScale: Schema.Number,
  pitchScale: Schema.Number,
  intonationScale: Schema.Number,
  volumeScale: Schema.Number,
  prePhonemeLength: Schema.Number,
  postPhonemeLength: Schema.Number,
  outputSamplingRate: Schema.Int,
  outputStereo: Schema.Boolean,
  kana: Schema.optional(Schema.String),
})
const parseAudioQuery = parse(AudioQuerySchema)

const StyleSchema = Schema.Struct({
  name: Schema.String,
  id: Schema.Int,
})
const SpeakersSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    styles: Schema.Array(StyleSchema),
  })
)
const parseSpeakers = parse(SpeakersSchema)

export type VoicevoxSpeechSynthesizerConfig = Readonly<{
  readonly baseUrl: URL
  readonly characterName: string
  readonly styleName?: string
  readonly requestTimeoutMillis: number
  readonly maximumAudioBytes: number
  readonly maximumTextCharactersPerRequest: number
  readonly retryPolicy: ProviderRetryPolicy
}>

export type VoicevoxSpeechSynthesizerDependencies = Readonly<{
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

const malformed = () => failure({ _tag: "MalformedResponse" })

/** Keeps bounded protocol metadata only; response bodies are never retained. */
const readRetryAfter = (response: Response): string | undefined => {
  const value = response.headers.get("retry-after")?.trim()
  if (!value || value.length > 64) return undefined
  return /^\d+$/.test(value) || /^[A-Za-z]{3}, .+ GMT$/.test(value)
    ? value
    : undefined
}

const assertSuccessful = (response: Response): void => {
  if (response.ok) return
  const retryAfter = readRetryAfter(response)
  throw failure({
    _tag: "HttpFailure",
    status: response.status,
    ...(retryAfter ? { retryAfter } : {}),
  })
}

const readBoundedBytes = async (
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

const requestWithDeadline = <Success>(
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

const endpoint = (baseUrl: URL, path: string): URL => {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}${path}`
  url.search = ""
  url.hash = ""
  return url
}

const projectSpeakers = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value
  return value.map((speaker) => {
    if (!isRecord(speaker)) return speaker
    return {
      name: speaker.name,
      styles: Array.isArray(speaker.styles)
        ? speaker.styles.map((style) =>
            isRecord(style) ? { name: style.name, id: style.id } : style
          )
        : speaker.styles,
    }
  })
}

const fetchJson = (
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

const resolveStyleId = (
  config: VoicevoxSpeechSynthesizerConfig,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined
): Effect.Effect<number, ProviderFailure> =>
  fetchJson(config, fetcher, endpoint(config.baseUrl, "speakers"), {
    method: "GET",
  }, signal).pipe(
    Effect.flatMap((value) =>
      parseSpeakers(projectSpeakers(value)).pipe(
        Effect.mapError(() => malformed())
      )
    ),
    Effect.flatMap((available) => {
      const speaker = available.find(
        (candidate) => candidate.name === config.characterName
      )
      const style = config.styleName
        ? speaker?.styles.find(
            (candidate) => candidate.name === config.styleName
          )
        : speaker?.styles[0]
      return style ? Effect.succeed(style.id) : Effect.fail(malformed())
    })
  )

const createAudioQuery = (
  config: VoicevoxSpeechSynthesizerConfig,
  fetcher: typeof fetch,
  text: string,
  styleId: number,
  signal: AbortSignal | undefined
) => {
  const url = endpoint(config.baseUrl, "audio_query")
  url.searchParams.set("text", text)
  url.searchParams.set("speaker", String(styleId))
  return fetchJson(config, fetcher, url, { method: "POST" }, signal).pipe(
    Effect.flatMap((value) =>
      parseAudioQuery(value).pipe(Effect.mapError(() => malformed()))
    )
  )
}

const readWave = async (
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> => {
  const contentType = response.headers.get("content-type")?.toLowerCase()
  if (!contentType?.startsWith("audio/wav")) throw malformed()
  return readBoundedBytes(response, maximumBytes)
}

const synthesizeChunk = (
  config: VoicevoxSpeechSynthesizerConfig,
  fetcher: typeof fetch,
  text: string,
  styleId: number,
  signal: AbortSignal | undefined
): Effect.Effect<Uint8Array, ProviderFailure> =>
  createAudioQuery(config, fetcher, text, styleId, signal).pipe(
    Effect.flatMap((query) => {
      const url = endpoint(config.baseUrl, "synthesis")
      url.searchParams.set("speaker", String(styleId))
      return requestWithDeadline(config, signal, async (boundedSignal) => {
        const response = await fetcher(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(query),
          signal: boundedSignal,
        })
        assertSuccessful(response)
        return readWave(response, config.maximumAudioBytes)
      })
    })
  )

const splitSpeech = (
  text: string,
  maximumCharacters: number
): readonly string[] => {
  const normalized = text.trim()
  if (!normalized) return []
  const characters = Array.from(normalized)
  const chunkSize = Math.max(1, Math.floor(maximumCharacters))
  const chunks: string[] = []
  for (let offset = 0; offset < characters.length; offset += chunkSize) {
    chunks.push(characters.slice(offset, offset + chunkSize).join(""))
  }
  return chunks
}

type ParsedWave = Readonly<{
  readonly header: Uint8Array
  readonly format: Uint8Array
  readonly data: Uint8Array
}>

const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + 4))

const uint32At = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true
  )

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    true
  )

const parseWave = (bytes: Uint8Array): ParsedWave | undefined => {
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0) !== "RIFF" ||
    ascii(bytes, 8) !== "WAVE" ||
    uint32At(bytes, 4) + 8 !== bytes.byteLength
  ) {
    return undefined
  }
  let format: Uint8Array | undefined
  let header: Uint8Array | undefined
  let data: Uint8Array | undefined
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) return undefined
    const name = ascii(bytes, offset)
    const length = uint32At(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const paddedEnd = dataEnd + (length % 2)
    if (dataEnd < dataStart || paddedEnd > bytes.byteLength) return undefined
    if (name === "fmt ") format = bytes.slice(dataStart, dataEnd)
    if (name === "data") {
      if (data !== undefined || paddedEnd !== bytes.byteLength) return undefined
      header = bytes.slice(0, dataStart)
      data = bytes.slice(dataStart, dataEnd)
    }
    offset = paddedEnd
  }
  if (!format || format.byteLength < 16 || !header || !data) return undefined
  return { header, format, data }
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index])

const mergeWaves = (
  waves: readonly Uint8Array[],
  maximumBytes: number
): Uint8Array | undefined => {
  const parsed = waves.map(parseWave)
  if (parsed.some((wave) => wave === undefined)) return undefined
  const complete = parsed as readonly ParsedWave[]
  const first = complete[0]
  if (!first || complete.some((wave) => !equalBytes(wave.format, first.format))) {
    return undefined
  }
  const dataLength = complete.reduce(
    (total, wave) => total + wave.data.byteLength,
    0
  )
  const outputLength = first.header.byteLength + dataLength
  if (!Number.isSafeInteger(outputLength) || outputLength > maximumBytes) {
    return undefined
  }
  const output = new Uint8Array(outputLength)
  output.set(first.header)
  let offset = first.header.byteLength
  for (const wave of complete) {
    output.set(wave.data, offset)
    offset += wave.data.byteLength
  }
  writeUint32(output, 4, output.byteLength - 8)
  writeUint32(output, first.header.byteLength - 4, dataLength)
  return output
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

export const makeVoicevoxSpeechSynthesizer = (
  config: VoicevoxSpeechSynthesizerConfig,
  dependencies: VoicevoxSpeechSynthesizerDependencies = {}
): SpeechSynthesizer => {
  const fetcher = dependencies.fetcher ?? fetch
  const synthesize: SpeechSynthesizer["synthesize"] = (request) => {
    const operation = (): Effect.Effect<Uint8Array, ProviderFailure> => {
      const chunks = splitSpeech(
        request.text,
        config.maximumTextCharactersPerRequest
      )
      if (chunks.length === 0) return Effect.fail(malformed())
      return Effect.gen(function* () {
        const styleId = yield* resolveStyleId(config, fetcher, request.signal)
        const waves: Uint8Array[] = []
        for (const chunk of chunks) {
          waves.push(
            yield* synthesizeChunk(
              config,
              fetcher,
              chunk,
              styleId,
              request.signal
            )
          )
        }
        const merged = mergeWaves(waves, config.maximumAudioBytes)
        return merged ?? (yield* Effect.fail(malformed()))
      })
    }
    const retried = dependencies.retryRuntime
      ? retryProvider(operation, config.retryPolicy, dependencies.retryRuntime)
      : retryProvider(operation, config.retryPolicy)
    const bounded = request.signal
      ? Effect.raceFirst(retried, failWhenAborted(request.signal))
      : retried
    return bounded.pipe(
      Effect.withSpan("episodeProduction.voicevoxSynthesize", {
        kind: "client",
        attributes: {
          "gen_ai.operation.name": "speech_synthesis",
          "reading_dictionary.snapshot_fingerprint":
            request.dictionarySnapshot?.fingerprint ?? "none",
          "reading_dictionary.entry_count":
            request.dictionarySnapshot?.entries.length ?? 0,
          // VOICEVOX user_dict is process-global; claiming per-owner application here is unsafe.
          "reading_dictionary.provider_applied": false,
        },
      })
    )
  }
  return deepFreeze({ synthesize })
}
