import { useAtomValue, useSetAtom } from "jotai"

import { resolvedThemeAtom, themeAtom } from "../atoms"
import type { ResolvedTheme, Theme } from "../model"

/**
 * 読みと書きを別のhookに分けているのは、`useAtom`で両方を受け取ると
 * 「書くだけのcomponent」まで値の変化で描き直されるため。
 */
export function useThemeValue(): Theme {
  return useAtomValue(themeAtom)
}

export function useResolvedTheme(): ResolvedTheme {
  return useAtomValue(resolvedThemeAtom)
}

export function useSetTheme(): (theme: Theme) => void {
  return useSetAtom(themeAtom)
}
