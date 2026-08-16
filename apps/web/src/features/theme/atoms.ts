import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

import {
  COLOR_SCHEME_QUERY,
  isTheme,
  resolveTheme,
  toggledTheme,
  type ResolvedTheme,
  type Theme,
} from "./model"

export const THEME_STORAGE_KEY = "theme"

/**
 * `index.html`の先頭スクリプトが同じキーを**素の文字列**として読む。初回描画
 * より前にクラスを当てて、テーマの一瞬のちらつきを防ぐためのもの。JSON化
 * すると読めなくなるので、保存形式は文字列のまま揃える。
 */
// jotaiの`SyncStorage`は型として再輸出されていないので、同じ形を自分で書く。
// 構造的に一致すれば`atomWithStorage`の同期版overloadが選ばれる。
type ThemeStorage = {
  getItem: (key: string, initialValue: Theme) => Theme
  setItem: (key: string, newValue: Theme) => void
  removeItem: (key: string) => void
  subscribe: (
    key: string,
    callback: (value: Theme) => void,
    initialValue: Theme
  ) => () => void
}

const rawThemeStorage: ThemeStorage = {
  getItem: (key, initialValue) => {
    const stored = localStorage.getItem(key)
    return isTheme(stored) ? stored : initialValue
  },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
  // 別タブでの変更を拾う。Effectで`storage`イベントを張る代わりに、atomの
  // 購読としてjotaiへ任せる。
  subscribe: (key, callback, initialValue) => {
    const handle = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== key) return
      callback(isTheme(event.newValue) ? event.newValue : initialValue)
    }
    window.addEventListener("storage", handle)
    return () => window.removeEventListener("storage", handle)
  },
}

/** 利用者が選んだ設定そのもの。`system`を含む。 */
export const themeAtom = atomWithStorage<Theme>(
  THEME_STORAGE_KEY,
  "system",
  rawThemeStorage,
  { getOnInit: true }
)

/**
 * OSの配色設定。`onMount`で購読を張るので、購読しているcomponentが1つも
 * 無い間はイベントリスナも存在しない。Effectで同じことをすると、購読の
 * 開始条件がcomponentの都合に引きずられる。
 */
export const systemThemeAtom = atom<ResolvedTheme>("light")
systemThemeAtom.onMount = (set) => {
  const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
  set(mediaQuery.matches ? "dark" : "light")
  const handle = (event: MediaQueryListEvent) =>
    set(event.matches ? "dark" : "light")
  mediaQuery.addEventListener("change", handle)
  return () => mediaQuery.removeEventListener("change", handle)
}

/** 実際に適用される配色。派生atomなので、正本は常に上の2つだけ。 */
export const resolvedThemeAtom = atom<ResolvedTheme>((get) =>
  resolveTheme(get(themeAtom), get(systemThemeAtom))
)

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  )
}

function isToggleShortcut(event: KeyboardEvent) {
  if (event.repeat) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (isEditableTarget(event.target)) return false
  return event.key.toLowerCase() === "d"
}

/**
 * `d`キーでの切り替え。
 *
 * 「操作」を書き込み専用atomとして持つと、更新規則がatom側に閉じ、呼び出し側は
 * 引数を渡すだけで済む。さらに`onMount`から自分自身を叩けるので、キーボード
 * 購読もEffectを使わずに同じ場所へ置ける。読み取り値は`null`固定なので、
 * これを購読してもcomponentが描き直されることはない。
 */
export const toggleThemeAtom = atom(null, (get, set) => {
  set(themeAtom, toggledTheme(get(themeAtom), get(systemThemeAtom)))
})
toggleThemeAtom.onMount = (toggle) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (isToggleShortcut(event)) toggle()
  }
  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}
