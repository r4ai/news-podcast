import { useSuspenseQuery } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { episodesQueryOptions, type Episode } from "@/features/episodes"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

export function useEpisodeLibrary() {
  const { data } = useSuspenseQuery(episodesQueryOptions)
  const access = api.useMutation(
    "post",
    "/v1/episodes/{episodeId}/audio-access"
  )
  const [audioUrl, setAudioUrl] = useState<string>()
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string>()
  const [pending, startTransition] = useTransition()

  function play(episodeId: string) {
    setPlayingEpisodeId(episodeId)
    startTransition(async () => {
      try {
        const result = await access.mutateAsync({
          params: { path: { episodeId } },
        })
        setAudioUrl(result.url)
      } catch {
        recordBrowserEvent("audio.error", { result: "access-failed" })
        toast.error("音声を再生できませんでした")
        setAudioUrl(undefined)
      } finally {
        setPlayingEpisodeId(undefined)
      }
    })
  }

  return {
    episodes: data.items as readonly Episode[],
    audioUrl,
    playingEpisodeId,
    pending,
    play,
  } as const
}
