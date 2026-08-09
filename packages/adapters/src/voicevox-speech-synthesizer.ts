import type {
  SpeechRequest,
  SpeechSynthesizer,
} from "@news-podcast/application"

import type { VoicevoxConfig } from "./config.js"

interface VoicevoxStyle {
  readonly name: string
  readonly id: number
}

interface VoicevoxSpeaker {
  readonly name: string
  readonly styles: readonly VoicevoxStyle[]
}

export class VoicevoxProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VoicevoxProviderError"
  }
}

export class VoicevoxSpeechSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly config: VoicevoxConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async synthesize(request: SpeechRequest): Promise<Uint8Array> {
    const styleId = await this.resolveStyleId(
      request.characterName || this.config.characterName,
      request.styleName ?? this.config.styleName
    )
    const chunks = splitSpeech(request.text)
    const waves = [] as Uint8Array[]
    for (const chunk of chunks) {
      waves.push(await this.synthesizeChunk(chunk, styleId))
    }
    return mergeWaves(waves)
  }

  private async synthesizeChunk(
    text: string,
    styleId: number
  ): Promise<Uint8Array> {
    const queryUrl = new URL("audio_query", this.config.baseUrl)
    queryUrl.searchParams.set("speaker", String(styleId))
    queryUrl.searchParams.set("text", text)
    const queryResponse = await this.fetcher(queryUrl, { method: "POST" })
    if (!queryResponse.ok) {
      throw new VoicevoxProviderError(
        `VOICEVOX audio_query failed with ${queryResponse.status}`
      )
    }

    const synthesisUrl = new URL("synthesis", this.config.baseUrl)
    synthesisUrl.searchParams.set("speaker", String(styleId))
    const synthesisResponse = await this.fetcher(synthesisUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await queryResponse.text(),
    })
    if (!synthesisResponse.ok) {
      throw new VoicevoxProviderError(
        `VOICEVOX synthesis failed with ${synthesisResponse.status}`
      )
    }

    return new Uint8Array(await synthesisResponse.arrayBuffer())
  }

  private async resolveStyleId(
    characterName: string,
    styleName?: string
  ): Promise<number> {
    const response = await this.fetcher(
      new URL("speakers", this.config.baseUrl)
    )
    if (!response.ok) {
      throw new VoicevoxProviderError(
        `VOICEVOX speakers failed with ${response.status}`
      )
    }

    const speakers = (await response.json()) as readonly VoicevoxSpeaker[]
    const speaker = speakers.find(
      (candidate) => candidate.name === characterName
    )
    const style = styleName
      ? speaker?.styles.find((candidate) => candidate.name === styleName)
      : speaker?.styles[0]
    if (!style) {
      throw new VoicevoxProviderError(
        `VOICEVOX style was not found for ${characterName}${styleName ? `/${styleName}` : ""}`
      )
    }

    return style.id
  }
}

function splitSpeech(text: string, maximumLength = 500): readonly string[] {
  const sentences = text
    .split(/(?<=[。！？!?])/u)
    .map((value) => value.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    if (sentence.length > maximumLength) {
      for (let offset = 0; offset < sentence.length; offset += maximumLength) {
        chunks.push(sentence.slice(offset, offset + maximumLength))
      }
      continue
    }
    const previous = chunks.at(-1)
    if (previous && previous.length + sentence.length <= maximumLength) {
      chunks[chunks.length - 1] = previous + sentence
    } else {
      chunks.push(sentence)
    }
  }
  if (chunks.length === 0)
    throw new VoicevoxProviderError("Speech text is empty")
  return chunks
}

function mergeWaves(waves: readonly Uint8Array[]): Uint8Array {
  if (waves.length === 1) return waves[0]!
  const parts = waves.map((wave) => {
    const dataOffset = findChunk(wave, "data")
    const size = readUint32(wave, dataOffset + 4)
    return wave.slice(dataOffset + 8, dataOffset + 8 + size)
  })
  const first = waves[0]!
  const firstDataOffset = findChunk(first, "data")
  const header = first.slice(0, firstDataOffset + 8)
  const dataLength = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(header.length + dataLength)
  result.set(header)
  let offset = header.length
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  writeUint32(result, 4, result.length - 8)
  writeUint32(result, firstDataOffset + 4, dataLength)
  return result
}

function findChunk(wave: Uint8Array, name: string): number {
  for (let offset = 12; offset + 8 <= wave.length;) {
    const chunkName = new TextDecoder().decode(wave.slice(offset, offset + 4))
    if (chunkName === name) return offset
    const size = readUint32(wave, offset + 4)
    offset += 8 + size + (size % 2)
  }
  throw new VoicevoxProviderError(`VOICEVOX response is missing ${name} chunk`)
}

function readUint32(value: Uint8Array, offset: number): number {
  return new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength
  ).getUint32(offset, true)
}

function writeUint32(value: Uint8Array, offset: number, number: number): void {
  new DataView(value.buffer, value.byteOffset, value.byteLength).setUint32(
    offset,
    number,
    true
  )
}
