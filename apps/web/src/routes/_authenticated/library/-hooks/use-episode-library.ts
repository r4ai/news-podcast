import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { useState } from "react"

import { episodesInfiniteQueryOptions } from "@/features/episodes"
export function useEpisodeLibrary() {
  // Production完了からLibraryのoutbox投影までの短いずれで、Homeが取得した
  // 古い一覧を表示し続けない。Libraryへ入るたびにowner-scoped一覧を再確認する。
  const list = useSuspenseInfiniteQuery({
    ...episodesInfiniteQueryOptions,
    refetchOnMount: "always",
  })
  const [audioUrl, setAudioUrl] = useState<string>()

  function play(episodeId: string) {
    setAudioUrl(`/v1/episodes/${encodeURIComponent(episodeId)}/audio`)
  }

  return {
    episodes: list.data.pages.flatMap((page) => page.items),
    audioUrl,
    playingEpisodeId: undefined,
    pending: false,
    hasNextPage: list.hasNextPage,
    isFetchingNextPage: list.isFetchingNextPage,
    isFetchNextPageError: list.isFetchNextPageError,
    fetchNextPage: () => void list.fetchNextPage(),
    play,
  } as const
}
