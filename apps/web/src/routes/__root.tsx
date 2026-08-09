import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"

import { AppShell, PanelSkeleton } from "@/app/app-shell"
import { RouteError } from "@/app/route-error"

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  pendingComponent: PanelSkeleton,
  errorComponent: RouteError,
})
