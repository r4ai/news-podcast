import { useSuspenseInfiniteQuery } from "@tanstack/react-query"

import { episodesInfiniteQueryOptions } from "@/features/episodes"
import { groupEpisodesByDate, type Episode, type EpisodePage } from "../-model"

/**
 * 番組一覧。
 *
 * Production完了からLibraryのoutbox投影までの短いずれで、Homeが取得した古い
 * 一覧を表示し続けない。Libraryへ入るたびにowner-scopedの一覧を取り直す。
 */
export function useEpisodeItems() {
  const query = useSuspenseInfiniteQuery({
    ...episodesInfiniteQueryOptions,
    refetchOnMount: "always",
  })

  const episodes = query.data.pages.flatMap(
    (page: EpisodePage) => page.items
  ) as Episode[]

  return {
    episodes,
    groups: groupEpisodesByDate(episodes),
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    // 続きの取得失敗は`Panel`まで上がらない (初回のデータは既にある)。
    // 画面から見えるのはここだけなので、行の末尾で伝えて再試行させる。
    isFetchNextPageError: query.isFetchNextPageError,
    fetchNextPage: () => {
      void query.fetchNextPage()
    },
  } as const
}
