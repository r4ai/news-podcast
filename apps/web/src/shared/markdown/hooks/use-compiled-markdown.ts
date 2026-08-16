import { useEffect, useState, type ReactNode } from "react"

import {
  createMarkdownProcessor,
  type MarkdownProcessorOptions,
} from "../pipeline/create-processor"
import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

export type MarkdownCompileState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly content: ReactNode
      /** 見出しの並び。目次の描画に使う。 */
      readonly outline: readonly HeadingOutlineEntry[]
    }
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
  options: MarkdownProcessorOptions
): MarkdownCompileState {
  const [state, setState] = useState<MarkdownCompileState>({
    status: "loading",
  })
  // optionsはpropsから毎render新しい物体で渡る。物体の同一性ではなく、
  // 中身の値そのものを依存にすることで、無意味な再コンパイルを避ける。
  const { baseUrl, headingBaseLevel, omitLeadingTitle } = options

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })

    createMarkdownProcessor({ baseUrl, headingBaseLevel, omitLeadingTitle })
      .process(markdown)
      .then((file: { result: unknown; data: { outline?: unknown } }) => {
        if (!cancelled) {
          setState({
            status: "ready",
            content: file.result as ReactNode,
            outline: (file.data.outline ??
              []) as readonly HeadingOutlineEntry[],
          })
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
  }, [markdown, baseUrl, headingBaseLevel, omitLeadingTitle])

  return state
}
