import type { VoicevoxConfig } from "./config.js"

interface VoicevoxUserDictWord {
  readonly surface: string
  readonly pronunciation: string
  readonly accent_type: number
  readonly word_uuid: string
}

export class VoicevoxDictionaryClient {
  private readonly baseUrl: URL

  constructor(
    config: VoicevoxConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = config.baseUrl
  }

  async listWords(
    signal?: AbortSignal
  ): Promise<readonly VoicevoxUserDictWord[]> {
    const url = new URL("user_dict", this.baseUrl)
    const response = await this.fetcher(url, signal ? { signal } : undefined)
    if (!response.ok) {
      throw new Error(`VOICEVOX user_dict list failed with ${response.status}`)
    }
    const data = (await response.json()) as Record<string, unknown>
    const words = data.words
    if (!words || typeof words !== "object") return []
    const entries = Object.entries(
      words as Record<string, Record<string, unknown>>
    )
    return entries.map(([uuid, word]) => ({
      surface: String(word.surface ?? ""),
      pronunciation: String(word.pronunciation ?? ""),
      accent_type: Number(word.accent_type ?? 0),
      word_uuid: uuid,
    }))
  }

  async addWord(
    surface: string,
    pronunciation: string,
    accentType: number,
    signal?: AbortSignal
  ): Promise<string> {
    const url = new URL("user_dict_word", this.baseUrl)
    url.searchParams.set("surface", surface)
    url.searchParams.set("pronunciation", pronunciation)
    url.searchParams.set("accent_type", String(accentType))
    const response = await this.fetcher(url, {
      method: "POST",
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      throw new Error(
        `VOICEVOX user_dict_word add failed with ${response.status}`
      )
    }
    return (await response.text()).trim()
  }

  async updateWord(
    wordUuid: string,
    surface: string,
    pronunciation: string,
    accentType: number,
    signal?: AbortSignal
  ): Promise<void> {
    const url = new URL(`user_dict_word/${wordUuid}`, this.baseUrl)
    url.searchParams.set("surface", surface)
    url.searchParams.set("pronunciation", pronunciation)
    url.searchParams.set("accent_type", String(accentType))
    const response = await this.fetcher(url, {
      method: "PUT",
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      throw new Error(
        `VOICEVOX user_dict_word update failed with ${response.status}`
      )
    }
  }

  async deleteWord(wordUuid: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(`user_dict_word/${wordUuid}`, this.baseUrl)
    const response = await this.fetcher(url, {
      method: "DELETE",
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      throw new Error(
        `VOICEVOX user_dict_word delete failed with ${response.status}`
      )
    }
  }
}
