import { useSetAtom } from "jotai"
import { useEffect, useRef } from "react"

import { parseEpisodeJobAgUiEvent } from "@news-podcast/contracts/agui"

import { subscribeEventStream } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

import { generationStreamAtom } from "../atoms"
import {
  emptyGenerationStream,
  openingGenerationStream,
  reduceGenerationStream,
} from "../model"

/**
 * 進行中ジョブのAG-UIストリームを購読し、畳み込んだ結果をatomへ書く。
 *
 * 値を返さずatomへ書くのは、フレームごとの描き直しを「その値を実際に描く
 * component」だけに閉じ込めるため (ADR-0060)。返り値にすると、購読は呼び出した
 * hookの位置に固定され、ダッシュボード全体が毎フレーム描き直される。
 *
 * 接続できなかった場合は `connected: false` のままにし、呼び出し側が従来の
 * 1秒ポーリングへ落とせるようにする。ストリームは進捗の見せ方を良くする
 * ためのもので、正しさの単一障害点にはしない。
 *
 * atomはアプリ全体で1つなので、購読を畳む時は必ず空へ戻す。残したままだと、
 * 画面を離れて戻ってきた最初の1描画に前のジョブの状態が出る。
 */
export function useGenerationStream(jobId: string | undefined): void {
  const setStream = useSetAtom(generationStreamAtom)
  const lastSequence = useRef(0)

  useEffect(() => {
    if (!jobId) {
      setStream(emptyGenerationStream)
      return
    }
    // ジョブが変わったら状態を捨てる。前のジョブのタイムラインが混ざらない。
    setStream(openingGenerationStream(jobId))
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

    return () => {
      controller.abort()
      // 購読を畳んだら値も捨てる。unmountを跨いで残すと、次にこの画面へ
      // 来た時の最初の1描画が前のジョブのままになる。
      setStream(emptyGenerationStream)
    }
  }, [jobId, setStream])
}
