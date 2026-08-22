import { useQueryErrorResetBoundary } from "@tanstack/react-query"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useEffect } from "react"
import { recordBrowserEvent } from "@/shared/observability/events"
import { AlertTriangle } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"

import { useReconnect } from "@/shared/lib/use-reconnect"

export function RouteError({ error, reset }: ErrorComponentProps) {
  // Reactの境界だけを開き直してもqueryはerrorのままなので、対でresetする。
  const { reset: resetQueries } = useQueryErrorResetBoundary()
  const errorType = error instanceof Error ? error.name : "UnknownError"
  useEffect(() => {
    recordBrowserEvent("route.error", { "error.type": errorType })
  }, [errorType])
  // 回線切れで着いた画面なら、戻った時点で自力で開き直す。
  useReconnect(() => {
    resetQueries()
    reset()
  })

  const message =
    error instanceof Error ? error.message : "データを取得できませんでした"

  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>
              <h1>接続を確認してください</h1>
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
          <Button
            onClick={() => {
              resetQueries()
              reset()
            }}
            variant="outline"
          >
            再試行
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
