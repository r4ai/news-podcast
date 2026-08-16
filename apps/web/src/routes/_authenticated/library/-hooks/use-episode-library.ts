import { useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"

import { episodesQueryOptions, type Episode } from "@/features/episodes"
export function useEpisodeLibrary() {
  // Production完了からLibraryのoutbox投影までの短いずれで、Homeが取得した
  // 古い一覧を表示し続けない。Libraryへ入るたびにowner-scoped一覧を再確認する。
  const { data } = useSuspenseQuery({
    ...episodesQueryOptions,
    refetchOnMount: "always",
  })
  const [audioUrl, setAudioUrl] = useState<string>()

  function play(episodeId: string) {
    setAudioUrl(`/v1/episodes/${encodeURIComponent(episodeId)}/audio`)
  }

  return {
    episodes: data.items as readonly Episode[],
    audioUrl,
    playingEpisodeId: undefined,
    pending: false,
    play,
  } as const
}
