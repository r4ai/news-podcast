import { useAtomValue } from "jotai"

import {
  generationAdoptedArticlesAtom,
  generationConnectedAtom,
  generationTimelineAtom,
} from "../atoms"
import { GenerationTimeline } from "./generation-timeline"

/**
 * 作業実況だけがストリームを購読する。
 *
 * 生成中はフレームが毎秒届くが、その内容を描くのはこのカードだけ。ここで
 * 購読を止めることで、1フレームの影響範囲が進捗カードの中に収まる
 * (ADR-0060)。
 */
export function ConnectedGenerationTimeline() {
  const timeline = useAtomValue(generationTimelineAtom)
  const adoptedArticles = useAtomValue(generationAdoptedArticlesAtom)
  const streaming = useAtomValue(generationConnectedAtom)

  return (
    <GenerationTimeline
      adoptedArticles={adoptedArticles}
      streaming={streaming}
      timeline={timeline}
    />
  )
}
