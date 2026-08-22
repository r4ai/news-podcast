import type { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router"

import { AppLoading } from "@/shared/components/app-loading"
import { RouteError } from "@/shared/components/route-error"
import { APP_NAME } from "@/shared/lib/page-title"

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // 各routeが`head`で名乗る題をここで document へ流す。名乗らないrouteは
  // このアプリ名のまま残る。
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: RootRoute,
  pendingComponent: AppLoading,
  errorComponent: RouteError,
})

function RootRoute() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  )
}
