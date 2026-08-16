import { useAtomValue } from "jotai"
import { useEffect } from "react"

import { resolvedThemeAtom, toggleThemeAtom } from "../atoms"
import type { ResolvedTheme } from "../model"

function suspendTransitions() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove())
    })
  }
}

function applyToDocument(resolved: ResolvedTheme, suspend: boolean) {
  const root = document.documentElement
  const restore = suspend ? suspendTransitions() : null
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  restore?.()
}

/**
 * 解決済みのテーマを`<html>`へ反映する。
 *
 * 反映先はReactの管理外にあるDOMなので、ここだけはEffectが正しい手段になる
 * (ADR-0047: Effectは外部システムとの同期にだけ使う)。呼び出し側に依存配列を
 * 書かせないよう、hookへ閉じ込める。`d`キーの購読もatomの`onMount`が持つので、
 * このhookを呼ぶこと自体がその購読を張ることになる。
 *
 * 初回の適用は`index.html`の先頭スクリプトが済ませているため、ここでの反映は
 * 実質「変更の追従」だけを担う。
 */
export function useAppliedTheme({
  disableTransitionOnChange = true,
}: { readonly disableTransitionOnChange?: boolean } = {}): void {
  const resolved = useAtomValue(resolvedThemeAtom)
  // 値は常にnull。購読することでキーボードショートカットの寿命をここへ揃える。
  useAtomValue(toggleThemeAtom)

  useEffect(() => {
    applyToDocument(resolved, disableTransitionOnChange)
  }, [resolved, disableTransitionOnChange])
}
