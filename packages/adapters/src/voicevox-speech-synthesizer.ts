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
    const queryUrl = new URL("audio_query", this.config.baseUrl)
    queryUrl.searchParams.set("speaker", String(styleId))
    queryUrl.searchParams.set("text", request.text)
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
