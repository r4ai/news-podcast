import { createFileRoute, redirect } from "@tanstack/react-router"
import { Headphones } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { authStateQueryOptions, safeRedirect } from "@/features/auth"
import { clearPersistedPlayback } from "@/features/player"
import { ThemeToggle } from "@/features/theme"
import { AppLoading } from "@/shared/components/app-loading"
import { pageTitle } from "@/shared/lib/page-title"
import { LoginMethods } from "./-components/login-methods"
import { useLogin } from "./-hooks/use-login"

export const Route = createFileRoute("/login/")({
  head: () => ({ meta: [{ title: pageTitle("ログイン") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    const auth = await context.queryClient.ensureQueryData(
      authStateQueryOptions
    )
    if (auth.authenticated) {
      throw redirect({ href: safeRedirect(search.redirect) })
    }
    // ここに着いた = 誰のものでもない状態。端末に残る再生の記録を捨てる。
    // 保存領域はorigin単位なので、次にログインした別の利用者へ前の利用者の
    // 番組名と続きが復元されてしまう。
    clearPersistedPlayback()
    return { auth }
  },
  component: LoginRoute,
  pendingComponent: AppLoading,
})

function LoginRoute() {
  const { auth } = Route.useRouteContext()
  const { redirect: destination } = Route.useSearch()
  const login = useLogin(destination)

  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-3 font-semibold">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Headphones aria-hidden="true" />
          </span>
          News Podcast
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>ログイン</h1>
            </CardTitle>
            <CardDescription>
              ニュース番組の生成と購読管理を続けます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginMethods auth={auth} login={login} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
