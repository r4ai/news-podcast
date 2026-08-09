import type { ErrorComponentProps } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"

export function RouteError({ error, reset }: ErrorComponentProps) {
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
          <Button onClick={reset} variant="outline">
            再試行
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
