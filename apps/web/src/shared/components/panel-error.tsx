import { AlertTriangle } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

import { describeError } from "@/shared/lib/error-message"
import { useReconnect } from "@/shared/lib/use-reconnect"

/**
 * パネル内に収まるエラー表示。`route-error.tsx` の全画面版と対になる。
 * 画面全体は落とさず、このパネルだけを再試行させる。
 */
export type PanelErrorProps = {
  readonly error: unknown
  /** Reactの境界とQueryのerror stateを対でリセットする。 */
  readonly reset: () => void
}

export function PanelError({ error, reset }: PanelErrorProps) {
  // 回線切れで落ちたなら、戻った時点でもう一度取りに行く。原因が手元から
  // 消えているのに、利用者へ押させる理由はない。
  useReconnect(reset)

  const message = describeError(error)

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
