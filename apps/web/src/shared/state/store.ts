import type { QueryClient } from "@tanstack/react-query"
import { createStore } from "jotai"
import { queryClientAtom } from "jotai-tanstack-query"

/**
 * アプリ全体で1つのjotai store。
 *
 * 既定のstoreに任せず明示的に持つのは、Reactの外 (routerのloader、observability
 * の初期化) からも同じ状態を読み書きするため。テストは`createAppStore()`で
 * 都度新しいstoreを作り、`Provider`で差し替えることで完全に隔離できる。
 */
export function createAppStore(queryClient: QueryClient) {
  const store = createStore()
  // server stateのatomが使うQueryClientを、routerのloaderと同じ実体に揃える。
  // 繋がないとatom側が独自のclientを作り、`loader`の先読み(`ensureQueryData`)が
  // 画面のatomに届かなくなる。
  store.set(queryClientAtom, queryClient)
  return store
}

export type AppStore = ReturnType<typeof createAppStore>
