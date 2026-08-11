// TTS読み上げ用のsurface→reading辞書（手動登録 + AI自動登録）のCRUD。
import type { RouteRegistrar } from "../../http/context.js"
import { registerCreateReadingDictionary } from "./create.js"
import { registerDeleteReadingDictionary } from "./delete.js"
import { registerListReadingDictionary } from "./list.js"
import { registerUpdateReadingDictionary } from "./update.js"

export const readingDictionaryRegistrars: readonly RouteRegistrar[] = [
  registerListReadingDictionary,
  registerCreateReadingDictionary,
  registerUpdateReadingDictionary,
  registerDeleteReadingDictionary,
]
