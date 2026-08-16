import { useEffect, useState } from "react"

import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

/** 画面上端からこの割合の位置を「今読んでいる行」とみなす。 */
const READING_LINE_RATIO = 0.3

/**
 * 今読んでいる節の見出しidを返す(ADR-0018: hookが状態を持ち、viewはpropsのみ)。
 *
 * 「画面に入っている見出し」ではなく**読み位置より上にある見出しのうち最も下の
 * もの**を選ぶ。見出しが画面外へ流れても、その節を読んでいる間は選ばれたまま
 * にするため。交差だけで判定すると、長い節の本文を読んでいる間は見出しが
 * どれも画面に無くなり、目次から現在地が消えてしまう。
 *
 * IntersectionObserverは位置の再計算を促す合図としてだけ使う。読み位置を
 * またぐ瞬間にだけ発火するので、節の途中では余計な再計算が起きない。
 */
export function useActiveHeading(
  outline: readonly HeadingOutlineEntry[]
): string | undefined {
  const [activeId, setActiveId] = useState<string>()
  const ids = outline.map((entry) => entry.id).join(" ")

  useEffect(() => {
    const headingIds = ids === "" ? [] : ids.split(" ")
    const elements = headingIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0) {
      setActiveId(undefined)
      return
    }

    const update = () => {
      const readingLine = window.innerHeight * READING_LINE_RATIO
      // 本文の順に見て、読み位置より上にある最後の見出しを採る。まだ最初の
      // 見出しへ達していなければ、どの節にも入っていないので選ばない。
      let current: string | undefined
      for (const element of elements) {
        if (element.getBoundingClientRect().top > readingLine) break
        current = element.id
      }
      setActiveId(current)
    }

    update()
    if (typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(update, {
      rootMargin: `0px 0px -${(1 - READING_LINE_RATIO) * 100}% 0px`,
    })
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [ids])

  return activeId
}
