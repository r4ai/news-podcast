import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, type RenderHookResult } from "@testing-library/react"
import { Provider as JotaiProvider } from "jotai"
import { Suspense, useState, type PropsWithChildren } from "react"
import { vi } from "vitest"

import { createAppStore, type AppStore } from "@/shared/state/store"

/**
 * テストごとに独立したjotai store。atomの値がテストを跨いで残らない。
 * server stateのatomは`queryClientAtom`を見るので、必ずそのテストの
 * QueryClientを繋いだ状態で作る。
 */
export function createTestStore(queryClient: QueryClient) {
  return createAppStore(queryClient)
}

export type TestStore = AppStore

/** テストごとに独立したcacheを持つQueryClient。再試行と鮮度保持を無効化する。 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function TestProviders({
  children,
  queryClient,
  store,
}: PropsWithChildren<{
  readonly queryClient: QueryClient
  readonly store?: TestStore
}>) {
  // storeを渡さない呼び出しでも、再renderのたびに作り直さない。
  const [fallbackStore] = useState(() => createAppStore(queryClient))
  return (
    <JotaiProvider store={store ?? fallbackStore}>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>{children}</Suspense>
      </QueryClientProvider>
    </JotaiProvider>
  )
}

/** Suspense queryを使うhookを、providerごとrenderする。 */
export function renderHookWithProviders<Result, Props = void>(
  hook: (props: Props) => Result,
  options: {
    readonly queryClient?: QueryClient
    readonly store?: TestStore
    /** propsを取るhookをrerenderで差し替えたい時 (URL状態の往復テストなど) に渡す。 */
    readonly initialProps?: Props
  } = {}
): RenderHookResult<Result, Props> & {
  readonly queryClient: QueryClient
  readonly store: TestStore
} {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const store = options.store ?? createTestStore(queryClient)
  const result = renderHook(hook, {
    initialProps: options.initialProps,
    wrapper: ({ children }) => (
      <TestProviders queryClient={queryClient} store={store}>
        {children}
      </TestProviders>
    ),
  })
  return Object.assign(result, { queryClient, store })
}

/**
 * `shared/api/client.ts` の openapi-fetch は `baseUrl: ""` の単一clientなので、
 * グローバルfetchを差し替えるだけで全てのqueryとmutationを制御できる。
 */
export type FetchRoute = {
  readonly method?: string
  readonly path: string
  readonly status?: number
  readonly body?: unknown
  /**
   * クエリ文字列で応答を出し分けたい時に使う。指定した組だけが一致条件になり、
   * 値に`undefined`を渡すと「そのパラメータが無いこと」を要求する。
   * ページングのように同じpathで別の結果を返す場合に必要。
   */
  readonly query?: Readonly<Record<string, string | undefined>>
  /** text/markdown・text/htmlなどJSON以外のボディをそのまま返したい時に使う。 */
  readonly raw?: string
  readonly contentType?: string
}

export function stubFetch(routes: readonly FetchRoute[]) {
  const calls: Array<{
    method: string
    url: string
    search: URLSearchParams
    headers: Headers
    body?: unknown
  }> = []

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url, "http://localhost")
    const method = request.method.toUpperCase()
    const rawBody = await request.clone().text()
    calls.push({
      method,
      url: url.pathname,
      search: url.searchParams,
      headers: request.headers,
      body: rawBody ? JSON.parse(rawBody) : undefined,
    })

    const route = routes.find(
      (candidate) =>
        candidate.path === url.pathname &&
        (candidate.method ?? "GET").toUpperCase() === method &&
        Object.entries(candidate.query ?? {}).every(
          ([key, value]) => (url.searchParams.get(key) ?? undefined) === value
        )
    )
    if (!route) {
      return new Response(JSON.stringify({ message: "not stubbed" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (route.raw !== undefined) {
      return new Response(route.raw, {
        status: route.status ?? 200,
        headers: { "Content-Type": route.contentType ?? "text/plain" },
      })
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  vi.stubGlobal("fetch", vi.fn(fetchMock))
  return { calls }
}
