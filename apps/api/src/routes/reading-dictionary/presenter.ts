interface ReadingDictionaryEntryRecord {
  readonly id: string
  readonly surface: string
  readonly reading: string
  readonly accentType: number
  readonly wordUuid?: string | null
  readonly source: "manual" | "ai_auto"
  readonly episodeJobId?: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** ストアのnull許容フィールドをAPIのoptionalフィールドへ変換する。 */
export function readingDictionaryResponse(entry: ReadingDictionaryEntryRecord) {
  return {
    id: entry.id,
    surface: entry.surface,
    reading: entry.reading,
    accentType: entry.accentType,
    wordUuid: entry.wordUuid ?? undefined,
    source: entry.source,
    episodeJobId: entry.episodeJobId ?? undefined,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}
