import { useEffect, useState, type ReactNode } from "react"

import { createMarkdownProcessor } from "../pipeline/create-processor"

export type MarkdownCompileState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly content: ReactNode }
  | { readonly status: "error"; readonly message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Markdownの解析に失敗しました"
}

/**
 * remark/rehypeパイプラインを非同期に実行する(ADR-0018: hookが状態を持ち、
 * viewはpropsのみ)。Shiki/mermaidの言語・図の遅延importを伴うため、
 * パイプライン全体の結果もPromiseになる。
 */
export function useCompiledMarkdown(
  markdown: string,
  baseUrl: string | undefined
): MarkdownCompileState {
  const [state, setState] = useState<MarkdownCompileState>({
    status: "loading",
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })

    createMarkdownProcessor(baseUrl)
      .process(markdown)
      .then((file: { result: unknown }) => {
        if (!cancelled) {
          setState({ status: "ready", content: file.result as ReactNode })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(error) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [markdown, baseUrl])

  return state
}
