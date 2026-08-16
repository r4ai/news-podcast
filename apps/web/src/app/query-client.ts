import { QueryClient } from "@tanstack/react-query"

import { createAppStore } from "@/shared/state/store"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
})

/**
 * server stateのatomとrouterのloaderが同じcacheを見るよう、jotai storeへ
 * このclientを繋いだ状態で配る (ADR: client stateとserver stateの単一store)。
 */
export const appStore = createAppStore(queryClient)
