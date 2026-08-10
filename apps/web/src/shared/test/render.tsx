import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, type RenderHookResult } from "@testing-library/react"
import { Suspense, type PropsWithChildren } from "react"
import { vi } from "vitest"

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
}: PropsWithChildren<{ readonly queryClient: QueryClient }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{children}</Suspense>
    </QueryClientProvider>
  )
}

/** Suspense queryを使うhookを、providerごとrenderする。 */
export function renderHookWithProviders<Result>(
  hook: () => Result,
  queryClient = createTestQueryClient()
): RenderHookResult<Result, void> & { readonly queryClient: QueryClient } {
  const result = renderHook(hook, {
    wrapper: ({ children }) => (
      <TestProviders queryClient={queryClient}>{children}</TestProviders>
    ),
  })
  return Object.assign(result, { queryClient })
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
}

export function stubFetch(routes: readonly FetchRoute[]) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url, "http://localhost")
    const method = request.method.toUpperCase()
    const rawBody = await request.clone().text()
    calls.push({
      method,
      url: url.pathname,
      body: rawBody ? JSON.parse(rawBody) : undefined,
    })

    const route = routes.find(
      (candidate) =>
        candidate.path === url.pathname &&
        (candidate.method ?? "GET").toUpperCase() === method
    )
    if (!route) {
      return new Response(JSON.stringify({ message: "not stubbed" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
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
