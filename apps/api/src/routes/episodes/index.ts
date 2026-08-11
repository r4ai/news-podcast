// 完成済みエピソードの一覧・取得・短命音声アクセス発行。
import type { RouteRegistrar } from "../../http/context.js"
import { registerAudioAccess } from "./audio-access.js"
import { registerGetEpisode } from "./get.js"
import { registerListEpisodes } from "./list.js"

export const episodesRegistrars: readonly RouteRegistrar[] = [
  registerListEpisodes,
  registerGetEpisode,
  registerAudioAccess,
]
