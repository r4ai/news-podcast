import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentPropsWithoutRef } from "react"

/**
 * GFMタスクリスト(`- [ ]`)のinputをshadcn/uiのCheckboxで描画する。
 * 記事本文は読み取り専用のため常に無効化し、ダークモードでもチェックの
 * コントラストが保たれるようにする(ネイティブcheckboxは配色が追従しない)。
 * タスクリスト以外のinputはそのまま透過する。
 */
export function Input(props: ComponentPropsWithoutRef<"input">) {
  if (props.type !== "checkbox") {
    return <input {...props} />
  }
  return (
    <Checkbox
      aria-label="チェックリスト"
      checked={props.checked === true}
      className={cn(
        "mr-1.5 inline-block size-4 shrink-0 align-[-2px]",
        props.className
      )}
      disabled={props.disabled === true}
    />
  )
}
