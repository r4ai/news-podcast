import type { ErrorComponentProps } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

/**
 * パネル内に収まるエラー表示。`route-error.tsx` の全画面版と対になる。
 * 画面全体は落とさず、このパネルだけを再試行させる。
 */
export function PanelError({ error, reset }: ErrorComponentProps) {
  const message =
    error instanceof Error ? error.message : "データを取得できませんでした"

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>この項目を表示できませんでした</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{message}</span>
        <Button onClick={reset} size="sm" variant="outline">
          再試行
        </Button>
      </AlertDescription>
    </Alert>
  )
}
