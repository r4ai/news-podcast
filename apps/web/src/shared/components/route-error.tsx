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

import { describeError } from "@/shared/lib/error-message"
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

  const message = describeError(error)

  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>
              {/*
                題は起きたことだけを言う。「接続を確認」と決め打つと、
                サーバ側の不調や見つからない場合に的外れな指示になる。
                次にできることは説明側が状態に応じて言う。
              */}
              <h1>ページを表示できませんでした</h1>
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
