import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { authStateQueryOptions } from "@/features/auth"
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
  },
  component: () => (
    <AppShell actions={<ThemeToggle />}>
      <Outlet />
    </AppShell>
  ),
})
