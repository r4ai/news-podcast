import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"

import { AppLoading } from "@/app/app-loading"
import { RouteError } from "@/app/route-error"

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  pendingComponent: AppLoading,
  errorComponent: RouteError,
})
