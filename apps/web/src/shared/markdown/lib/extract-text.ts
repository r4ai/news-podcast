import { Children, isValidElement, type ReactNode } from "react"

/** ReactNodeツリーからプレーンテキストを再帰的に取り出す。コピー用途など。 */
export function extractPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }
  if (!isValidElement(node)) {
    return ""
  }
  const children = (node.props as { children?: ReactNode }).children
  return Children.toArray(children)
    .map((child) => extractPlainText(child))
    .join("")
}
