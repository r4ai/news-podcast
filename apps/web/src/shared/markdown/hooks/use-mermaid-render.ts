import { useEffect, useState } from "react"

import { buildMermaidThemeVariables } from "../lib/mermaid-theme"

export type MermaidRenderState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly svg: string }
  | { readonly status: "error"; readonly message: string }

let mermaidModulePromise: Promise<typeof import("mermaid")> | undefined

/** mermaidは~1MBあるため、図が存在するときだけ動的importする。 */
function loadMermaidModule(): Promise<typeof import("mermaid")> {
  mermaidModulePromise ??= import("mermaid")
  return mermaidModulePromise
}

function readCssToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim()
}

let renderCounter = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "図の解析に失敗しました"
}

/**
 * mermaidの動的importと描画をまとめたhook。構文エラーの図はエラー状態を
 * 返すだけでthrowしない。呼び出し側はエラー時に元のコードをコード
 * ブロックとして表示する。`isDark`はcurrent themeのCSSトークンを読み直す
 * ための再描画トリガーとしてだけ使う。
 */
export function useMermaidRender(
  code: string,
  isDark: boolean
): MermaidRenderState {
  const [state, setState] = useState<MermaidRenderState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })

    loadMermaidModule()
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: buildMermaidThemeVariables(readCssToken),
        })
        renderCounter += 1
        const { svg } = await mermaid.render(
          `markdown-mermaid-${renderCounter}`,
          code
        )
        if (!cancelled) {
          setState({ status: "ready", svg })
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
  }, [code, isDark])

  return state
}
