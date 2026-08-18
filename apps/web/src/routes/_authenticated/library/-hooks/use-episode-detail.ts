import { useSuspenseQuery } from "@tanstack/react-query"

import { episodeQueryOptions } from "@/features/episodes"
import type { Episode } from "../-model"

/** 選択中の番組。台本も出典もこの1件に載っているので、追加の取得は要らない。 */
export function useEpisodeDetail(episodeId: string): Episode {
  const { data } = useSuspenseQuery(episodeQueryOptions(episodeId))
  return data as Episode
}
