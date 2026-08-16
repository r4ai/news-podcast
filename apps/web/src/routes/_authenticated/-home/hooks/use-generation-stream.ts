import { useEffect, useRef, useState } from "react"

import { parseEpisodeJobAgUiEvent } from "@news-podcast/contracts/agui"

import { subscribeEventStream } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

import {
  emptyGenerationStream,
  reduceGenerationStream,
  type GenerationStream,
} from "../model"

/**
 * 進行中ジョブのAG-UIストリームを購読する。
 *
 * 接続できなかった場合は `connected: false` のまま返し、呼び出し側が
 * 従来の1秒ポーリングに落とせるようにする。ストリームは進捗の見せ方を
 * 良くするためのもので、正しさの単一障害点にはしない。
 */
export function useGenerationStream(jobId: string | undefined) {
  const [stream, setStream] = useState<GenerationStream>(emptyGenerationStream)
  const lastSequence = useRef(0)

  useEffect(() => {
    if (!jobId) {
      setStream(emptyGenerationStream)
      return
    }
    // ジョブが変わったら状態を捨てる。前のジョブのタイムラインが混ざらない。
    setStream(emptyGenerationStream)
    lastSequence.current = 0
    const controller = new AbortController()

    void subscribeEventStream(`/v1/episode-jobs/${jobId}/events`, {
      signal: controller.signal,
      onOpen: () => {
        setStream((current) => ({ ...current, connected: true }))
        recordBrowserEvent("episode.stream_connected")
      },
      onFrame: (frame) => {
        const sequence = frame.id === undefined ? undefined : Number(frame.id)
        if (
          sequence !== undefined &&
          (!Number.isSafeInteger(sequence) || sequence <= lastSequence.current)
        ) {
          return
        }
        try {
          const event = parseEpisodeJobAgUiEvent(
            JSON.parse(frame.data) as unknown
          )
          if (sequence !== undefined) lastSequence.current = sequence
          setStream((current) => reduceGenerationStream(current, event))
        } catch {
          return
        }
      },
      onGiveUp: () => {
        setStream((current) => ({ ...current, connected: false }))
        recordBrowserEvent("episode.stream_fallback")
      },
    }).finally(() => {
      if (!controller.signal.aborted) {
        setStream((current) => ({ ...current, connected: false }))
      }
    })

    return () => controller.abort()
  }, [jobId])

  return stream
}
