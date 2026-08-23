import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { authStateQueryOptions, LogoutButton } from "@/features/auth"
import { PlayerHost } from "@/features/player"
import { ThemeToggle } from "@/features/theme"
import { AppShell } from "@/shared/layouts/app-shell"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const auth = await context.queryClient.ensureQueryData(
      authStateQueryOptions
    )
    if (!auth.authenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      })
    }
    return { auth }
  },
  // 再生バーは`Outlet`の外に置く。中に置くとページを移った瞬間に
  // `<audio>`ごと外れ、音が途切れる (ADR-0064)。
  component: AuthenticatedRoute,
})

function AuthenticatedRoute() {
  const { auth } = Route.useRouteContext()
  return (
    <AppShell
      actions={
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <LogoutButton auth={auth} />
        </div>
      }
      player={<PlayerHost />}
    >
      <Outlet />
    </AppShell>
  )
}
