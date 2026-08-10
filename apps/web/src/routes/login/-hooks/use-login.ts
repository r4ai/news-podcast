import { useQueryClient } from "@tanstack/react-query"
import { useState, useTransition } from "react"

import {
  authStateQueryOptions,
  loginWithGoogle,
  type AuthState,
} from "@/features/auth"
import { loginForDevelopment } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

export type LoginState = ReturnType<typeof useLogin>

export function useLogin(destination: string) {
  const queryClient = useQueryClient()
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
        // 認証cookieを確実に反映させるため、SPA遷移ではなく再読み込みで戻る。
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

  return {
    error,
    password,
    pending,
    setPassword,
    submitDevelopment: () => completeLogin(() => loginForDevelopment(password)),
    submitGoogle: () =>
      completeLogin(() =>
        loginWithGoogle(new URL(destination, window.location.origin).href)
      ),
  } as const
}

/** 表示可能なログイン方法の数。0なら設定不足として案内する。 */
export function loginMethodCount(auth: AuthState): number {
  return (
    Number(auth.loginMethods.development) + Number(auth.loginMethods.google)
  )
}
