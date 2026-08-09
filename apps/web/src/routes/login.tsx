import { useState, useTransition } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Headphones } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

import { loginForDevelopment } from "@/api/client"
import { AppLoading } from "@/app/app-loading"
import { queryClient } from "@/app/query-client"
import {
  type AuthState,
  authStateQueryOptions,
  loginWithGoogle,
  safeRedirect,
} from "@/auth/auth"
import { ThemeToggle } from "@/components/theme-toggle"
import { recordBrowserEvent } from "@/observability/events"

export const Route = createFileRoute("/login")({
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
    return { auth }
  },
  component: LoginPage,
  pendingComponent: AppLoading,
})

function useLogin(destination: string) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function completeLogin(action: () => Promise<void>) {
    setError(undefined)
    startTransition(async () => {
      try {
        await action()
        recordBrowserEvent("login.result", { result: "succeeded" })
        await queryClient.invalidateQueries({
          queryKey: authStateQueryOptions.queryKey,
        })
        window.location.replace(destination)
      } catch (loginError) {
        recordBrowserEvent("login.result", { result: "failed" })
        setError(
          loginError instanceof Error
            ? loginError.message
            : "ログインできませんでした"
        )
      }
    })
  }

  return { completeLogin, error, password, pending, setPassword }
}

function DevelopmentLoginForm({
  error,
  onLogin,
  password,
  pending,
  setPassword,
}: {
  readonly error?: string
  readonly onLogin: () => void
  readonly password: string
  readonly pending: boolean
  readonly setPassword: (value: string) => void
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onLogin()
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="development-password">開発パスワード</FieldLabel>
        <Input
          aria-invalid={Boolean(error)}
          autoComplete="current-password"
          disabled={pending}
          id="development-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <Button disabled={pending || password.length === 0} type="submit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "ログイン中…" : "開発ユーザーでログイン"}
      </Button>
    </form>
  )
}

function GoogleLoginButton({
  destination,
  enabled,
  hasBothMethods,
  login,
}: {
  readonly destination: string
  readonly enabled: boolean
  readonly hasBothMethods: boolean
  readonly login: ReturnType<typeof useLogin>
}) {
  if (!enabled) return null

  return (
    <Button
      disabled={login.pending}
      onClick={() =>
        login.completeLogin(() =>
          loginWithGoogle(new URL(destination, window.location.origin).href)
        )
      }
      type="button"
      variant={hasBothMethods ? "outline" : "default"}
    >
      {login.pending ? <Spinner data-icon="inline-start" /> : null}
      Googleでログイン
    </Button>
  )
}

function LoginError({
  error,
  show,
}: {
  readonly error?: string
  readonly show: boolean
}) {
  if (!show || !error) return null

  return (
    <Alert variant="destructive">
      <AlertTitle>ログインできませんでした</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}

function LoginMethods({
  auth,
  destination,
  login,
}: {
  readonly auth: AuthState
  readonly destination: string
  readonly login: ReturnType<typeof useLogin>
}) {
  const { development, google } = auth.loginMethods
  const methodCount = Number(development) + Number(google)

  if (methodCount === 0) {
    return (
      <Alert>
        <AlertTitle>ログイン方法が設定されていません</AlertTitle>
        <AlertDescription>
          管理者に認証設定を確認してください。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <FieldGroup>
      <GoogleLoginButton
        destination={destination}
        enabled={google}
        hasBothMethods={methodCount === 2}
        login={login}
      />
      {methodCount === 2 ? <FieldSeparator>開発用</FieldSeparator> : null}
      {development ? (
        <DevelopmentLoginForm
          error={login.error}
          onLogin={() =>
            login.completeLogin(() => loginForDevelopment(login.password))
          }
          password={login.password}
          pending={login.pending}
          setPassword={login.setPassword}
        />
      ) : null}
      <LoginError error={login.error} show={!development} />
    </FieldGroup>
  )
}

function LoginPage() {
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
            <LoginMethods auth={auth} destination={destination} login={login} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
