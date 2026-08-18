import { infiniteQueryOptions } from "@tanstack/react-query"

import { api, fetchClient } from "@/shared/api"
import type { Episode } from "../model"

/** `/`（生成）と `/library` の両方が読む。 */
export const episodesQueryOptions = api.queryOptions("get", "/v1/episodes")

export function episodeQueryOptions(episodeId: string) {
  return api.queryOptions("get", "/v1/episodes/{episodeId}", {
    params: { path: { episodeId } },
  })
}

type EpisodePage = {
  readonly items: readonly Episode[]
  readonly page: {
    readonly hasMore: boolean
    readonly nextCursor?: string | null
  }
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
