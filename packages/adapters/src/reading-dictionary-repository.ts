import type {
  ReadingDictionaryEntry,
  ReadingDictionaryRepository,
} from "@news-podcast/application"
import type { LocalStore, ReadingDictionaryDto } from "./db/local-store.js"
import type { VoicevoxDictionaryClient } from "./voicevox-dictionary-client.js"

export class SqliteReadingDictionaryRepository
  implements ReadingDictionaryRepository
{
  constructor(
    private readonly store: LocalStore,
    private readonly voicevoxClient?: VoicevoxDictionaryClient,
  ) {}

  async list(ownerId: string): Promise<readonly ReadingDictionaryEntry[]> {
    return this.store.listReadingDictionary(ownerId).map(toEntry)
  }

  async add(input: {
    readonly ownerId: string
    readonly surface: string
    readonly reading: string
    readonly accentType?: number
    readonly source: "manual" | "ai_auto"
    readonly episodeJobId?: string
  }): Promise<ReadingDictionaryEntry> {
    let wordUuid: string | null = null
    if (this.voicevoxClient) {
      try {
        wordUuid = await this.voicevoxClient.addWord(
          input.surface,
          input.reading,
          input.accentType ?? 0,
        )
      } catch {
        // VOICEVOX unavailable
      }
    }
    const dto = this.store.addReadingDictionary(input)
    if (wordUuid) {
      this.store.updateReadingDictionary(input.ownerId, dto.id, { wordUuid })
    }
    const final = this.store
      .listReadingDictionary(input.ownerId)
      .find((e) => e.id === dto.id)
    return toEntry(final ?? dto)
  }

  async update(input: {
    readonly ownerId: string
    readonly id: string
    readonly surface?: string
    readonly reading?: string
    readonly accentType?: number
  }): Promise<ReadingDictionaryEntry> {
    const dto = this.store.updateReadingDictionary(
      input.ownerId,
      input.id,
      {
        ...(input.surface !== undefined ? { surface: input.surface } : {}),
        ...(input.reading !== undefined ? { reading: input.reading } : {}),
        ...(input.accentType !== undefined
          ? { accentType: input.accentType }
          : {}),
      },
    )
    if (!dto) throw new Error("Reading dictionary entry not found")

    if (this.voicevoxClient) {
      try {
        if (dto.wordUuid) {
          await this.voicevoxClient.updateWord(
            dto.wordUuid,
            dto.surface,
            dto.reading,
            dto.accentType,
          )
        } else {
          const uuid = await this.voicevoxClient.addWord(
            dto.surface,
            dto.reading,
            dto.accentType,
          )
          this.store.updateReadingDictionary(input.ownerId, dto.id, {
            wordUuid: uuid,
          })
        }
      } catch {
        // VOICEVOX unavailable
      }
    }
    const final = this.store
      .listReadingDictionary(input.ownerId)
      .find((e) => e.id === dto.id)
    return toEntry(final ?? dto)
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const entries = this.store.listReadingDictionary(ownerId)
    const entry = entries.find((e) => e.id === id)
    if (entry?.wordUuid && this.voicevoxClient) {
      await this.voicevoxClient
        .deleteWord(entry.wordUuid)
        .catch(() => undefined)
    }
    this.store.deleteReadingDictionary(ownerId, id)
  }

  async syncToVoicevox(ownerId: string): Promise<void> {
    if (!this.voicevoxClient) return
    const entries = this.store.listReadingDictionary(ownerId)

    const remoteWords = await this.voicevoxClient
      .listWords()
      .catch(() => [] as const)
    const remoteBySurface = new Map(
      remoteWords.map((w) => [w.surface, w]),
    )
    const localBySurface = new Map(
      entries.map((e) => [e.surface, e]),
    )

    for (const [surface, entry] of localBySurface) {
      const remote = remoteBySurface.get(surface)
      if (!remote) {
        try {
          const uuid = await this.voicevoxClient.addWord(
            entry.surface,
            entry.reading,
            entry.accentType,
          )
          this.store.updateReadingDictionary(ownerId, entry.id, {
            wordUuid: uuid,
          })
        } catch {
          // VOICEVOX unavailable
        }
      } else if (entry.wordUuid !== remote.word_uuid) {
        this.store.updateReadingDictionary(ownerId, entry.id, {
          wordUuid: remote.word_uuid,
        })
      }
    }
  }
}

function toEntry(dto: ReadingDictionaryDto): ReadingDictionaryEntry {
  return {
    id: dto.id,
    surface: dto.surface,
    reading: dto.reading,
    accentType: dto.accentType,
    ...(dto.wordUuid !== null ? { wordUuid: dto.wordUuid } : {}),
    source: dto.source,
    ...(dto.episodeJobId !== null
      ? { episodeJobId: dto.episodeJobId }
      : {}),
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
  }
}
