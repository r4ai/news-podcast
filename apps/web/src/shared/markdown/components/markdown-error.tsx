import { TriangleAlert } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"

/**
 * Markdown解析自体が失敗したときの表示。個別ブロックのフォールバックとは別。
 * 役割がshadcn/uiのAlertとそのまま重なるので、見た目を手書きせずそちらへ委ねる
 * (`role="alert"`もAlertが持つ)。
 */
export function MarkdownError({ message }: { readonly message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>本文を表示できませんでした</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
