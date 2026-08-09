import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { AppShell } from "@/app/app-shell"
import { authStateQueryOptions } from "@/auth/auth"

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
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
