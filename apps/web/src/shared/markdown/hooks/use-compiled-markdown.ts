import { useEffect, useState, type ReactNode } from "react"

import type { MarkdownProcessorOptions } from "../pipeline/create-processor"
import type { HeadingOutlineEntry } from "../pipeline/rehype-heading-outline"

/**
 * パイプライン本体 (unified + rehype-raw + KaTeX + Shiki と、そのCSS) は
 * 圧縮後で200 kBを超える。記事一覧を見ているだけの利用者には要らないので、
 * 本文を実際にコンパイルする時まで読み込まない。
 *
 * moduleは1度読めばキャッシュされるので、2記事目以降は待ちが無い。
 */
let processorModule:
  | Promise<typeof import("../pipeline/create-processor")>
  | undefined

function loadProcessor() {
  processorModule ??= import("../pipeline/create-processor")
  return processorModule
}

/**
 * 本文が届く前にパイプラインの取得を始める。
 *
 * これが無いと「本文をfetch → パイプラインをfetch → コンパイル」と直列に
 * なり、遅延読み込みにした分がそのまま表示の遅れになる。読み手が記事を
 * 開いた時点で呼べば、2つの取得が重なる。
 */
export function preloadMarkdownProcessor(): void {
  void loadProcessor().catch(() => {
    // 失敗しても実コンパイル時に取り直す。ここでは何も報告しない。
    processorModule = undefined
  })
}

/**
 * 記事を開いた時点でパイプラインの取得を始めるhook。
 *
 * moduleの取得という外部への働きかけなのでEffectで行うが、呼び出し側に
 * 依存配列を書かせないようここへ閉じ込める。
 */
export function usePreloadMarkdownProcessor(): void {
  useEffect(preloadMarkdownProcessor, [])
}

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

    loadProcessor()
      .then(({ createMarkdownProcessor }) =>
        createMarkdownProcessor({
          baseUrl,
          headingBaseLevel,
          omitLeadingTitle,
        }).process(markdown)
      )
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
