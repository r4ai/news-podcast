import { useState } from "react"

import type { ErrorComponentProps } from "@tanstack/react-router"

import { loginForDevelopment } from "@/api/client"

export function RouteError({ error, reset }: ErrorComponentProps) {
  const [pending, setPending] = useState(false)
  const [password, setPassword] = useState("")
  const message =
    error instanceof Error ? error.message : "データを取得できませんでした"

  async function login() {
    setPending(true)
    try {
      await loginForDevelopment(password)
      reset()
      window.location.reload()
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <h1 className="text-xl font-semibold">接続を確認してください</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-5 flex gap-3">
        <input
          aria-label="開発ユーザーのパスワード"
          className="rounded-lg border bg-background px-3 py-2"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="開発パスワード"
          type="password"
          value={password}
        />
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
          onClick={() => void login()}
          type="button"
        >
          {pending ? "ログイン中…" : "開発ユーザーでログイン"}
        </button>
        <button
          className="rounded-lg border px-4 py-2"
          onClick={reset}
          type="button"
        >
          再試行
        </button>
      </div>
    </section>
  )
}
