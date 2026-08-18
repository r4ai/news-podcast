import { infiniteQueryOptions } from "@tanstack/react-query"

import { api, fetchClient } from "@/shared/api"
import type { EpisodePage } from "../model"

/**
 * `/`（生成）が読む最新の一覧。
 *
 * `/library`の無限読みはこの鍵を接頭辞に持つので、完成後の
 * `invalidateQueries`は単発の読みと無限の読みの両方へ届く。
 */
export const episodesQueryOptions = api.queryOptions("get", "/v1/episodes")

export function episodeQueryOptions(episodeId: string) {
  return api.queryOptions("get", "/v1/episodes/{episodeId}", {
    params: { path: { episodeId } },
  })
}

/** Library専用。取得済みのページを保ったままserver cursorを順に辿る。 */
export const episodesInfiniteQueryOptions = infiniteQueryOptions({
  queryKey: [...episodesQueryOptions.queryKey, "infinite"] as const,
  queryFn: async ({ pageParam, signal }) => {
    const { data, error } = await fetchClient.GET("/v1/episodes", {
      signal,
      params: {
        query: pageParam === undefined ? {} : { cursor: pageParam },
      },
    })
    if (error) throw error
    return data as EpisodePage
  },
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: EpisodePage) =>
    last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
})
