import { parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { ProviderFailure } from "../../../domain/provider-reliability.js"
import type { VoicevoxSpeechSynthesizerConfig } from "./config.js"
import {
  assertSuccessful,
  endpoint,
  fetchJson,
  isRecord,
  malformed,
  readBoundedBytes,
  requestWithDeadline,
} from "./http.js"

/**
 * VOICEVOX HTTP APIの形。話者一覧・音声クエリ・合成の3本だけを使う。
 */

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
  pauseLength: Schema.optional(Schema.NullOr(Schema.Number)),
  pauseLengthScale: Schema.optional(Schema.Number),
  outputSamplingRate: Schema.Int,
  outputStereo: Schema.Boolean,
  kana: Schema.optional(Schema.String),
})
const parseAudioQuery = parse(AudioQuerySchema)

const StyleSchema = Schema.Struct({ name: Schema.String, id: Schema.Int })
const SpeakersSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    styles: Schema.Array(StyleSchema),
  })
)
const parseSpeakers = parse(SpeakersSchema)

// 話者一覧は必要な項目だけに削ってから検証し、未知の付随情報を持ち込まない。
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

export const resolveStyleId = (
  config: VoicevoxSpeechSynthesizerConfig,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined
): Effect.Effect<number, ProviderFailure> =>
  fetchJson(
    config,
    fetcher,
    endpoint(config.baseUrl, "speakers"),
    { method: "GET" },
    signal
  ).pipe(
    Effect.flatMap((value) =>
      parseSpeakers(projectSpeakers(value)).pipe(
        Effect.mapError(() => malformed())
      )
    ),
    Effect.flatMap((available) => {
      const speaker = available.find(
        (candidate) => candidate.name === config.characterName
      )
      // スタイル未指定なら、その話者の先頭スタイルを既定として使う。
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

export const synthesizeChunk = (
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

/** 1リクエストあたりの文字数上限で、書記素単位に分割する。 */
export const splitSpeech = (
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
