import { useEffect, useState } from "react"

function readDarkClass(): boolean {
  return document.documentElement.classList.contains("dark")
}

/**
 * `features/theme` へは依存しない(ADR-0018の層規則により`shared`は
 * `features`を参照できない)。代わりに`<html>`のclass変化を直接観測して
 * dark/lightを判定し、Mermaidの再描画トリガーに使う。
 */
export function useDocumentThemeIsDark(): boolean {
  const [isDark, setIsDark] = useState(readDarkClass)

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(readDarkClass()))
    observer.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isDark
}
