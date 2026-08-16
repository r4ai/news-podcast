import { deepFreeze } from "@news-podcast/kernel"

import type { ReadingDictionarySnapshotEntry } from "../domain/reading-dictionary.js"

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Applies immutable owner-scoped readings in one pass, preferring longer terms. */
export const applyReadingDictionary = (
  text: string,
  entries: readonly ReadingDictionarySnapshotEntry[]
) => {
  const bySurface = new Map<string, string>()
  for (const entry of entries) {
    if (!bySurface.has(entry.surface))
      bySurface.set(entry.surface, entry.reading)
  }
  const surfaces = [...bySurface.keys()].sort(
    (left, right) => [...right].length - [...left].length
  )
  if (surfaces.length === 0) {
    return deepFreeze({ text, replacementCount: 0 })
  }
  const pattern = new RegExp(surfaces.map(escapeRegExp).join("|"), "gu")
  let replacementCount = 0
  const replaced = text.replace(pattern, (surface) => {
    replacementCount += 1
    return bySurface.get(surface)!
  })
  return deepFreeze({ text: replaced, replacementCount })
}
