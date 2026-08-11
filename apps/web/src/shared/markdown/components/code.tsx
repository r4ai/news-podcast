import type { ComponentPropsWithoutRef } from "react"

import { InlineCode } from "./inline-code"

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  readonly isBlock?: boolean
}

/**
 * fenced code block内の`<code>`とinline codeの`<code>`はどちらも同じhastの
 * `code`タグだが、前者はCodeBlockが行番号などの装飾を担うため素のまま通し、
 * 後者だけInlineCodeで見た目を付ける。`isBlock`は`rehype-mark-code-blocks`
 * が親要素から判定して付与する。
 */
export function Code({ isBlock, ...props }: CodeProps) {
  if (isBlock) {
    return <code {...props} />
  }
  return <InlineCode {...props} />
}
