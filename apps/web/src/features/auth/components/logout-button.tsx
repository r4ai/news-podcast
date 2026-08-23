import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import { LogOut } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { resetOwnerPlaybackAtom } from "@/features/player"
import { recordBrowserEvent } from "@/shared/observability/events"
import { toast } from "@/shared/ui/toast"
import type { AuthenticatedAuthState } from "../model"
import { logoutSession } from "../api/logout"

export type LogoutButtonProps = {
  readonly auth: AuthenticatedAuthState
  readonly logout?: () => Promise<void>
  readonly navigateToLogin?: (path: string) => void
}

const defaultNavigateToLogin = (path: string) => window.location.replace(path)

export function LogoutButton({
  auth,
  logout = () => logoutSession(auth),
  navigateToLogin = defaultNavigateToLogin,
}: LogoutButtonProps) {
  const queryClient = useQueryClient()
  const resetPlayback = useSetAtom(resetOwnerPlaybackAtom)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function submitLogout() {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      await logout()
      recordBrowserEvent("logout.result", { result: "succeeded" })
      resetPlayback()
      queryClient.clear()
      // 戻る操作で認証済み画面を再利用しないよう、documentごと置き換える。
      navigateToLogin("/login")
    } catch {
      recordBrowserEvent("logout.result", { result: "failed" })
      const message = "ログアウトできませんでした。もう一度お試しください。"
      setError(message)
      setPending(false)
      toast.error(message)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-busy={pending}
        aria-describedby={error ? "logout-error" : undefined}
        aria-label="ログアウト"
        className="min-h-11 px-3"
        disabled={pending}
        onClick={submitLogout}
        type="button"
        variant="ghost"
      >
        {pending ? (
          <Spinner aria-hidden="true" />
        ) : (
          <LogOut aria-hidden="true" />
        )}
        <span className="hidden md:inline">
          {pending ? "ログアウト中…" : "ログアウト"}
        </span>
      </Button>
      {error ? (
        <span className="sr-only" id="logout-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
