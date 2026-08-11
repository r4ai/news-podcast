import { useDocumentThemeIsDark } from "../../hooks/use-document-theme"
import { useMermaidRender } from "../../hooks/use-mermaid-render"
import { MermaidFallback } from "./mermaid-fallback"
import { MermaidSkeleton } from "./mermaid-skeleton"

/**
 * ` ```mermaid ` フェンスを図として描画する。mermaidは~1MBあるため、
 * `useMermaidRender`がこのコンポーネントが実際にマウントされたとき
 * (=本文にmermaidブロックが存在するとき)だけ動的importする。
 */
export function Mermaid({ code }: { readonly code: string }) {
  const isDark = useDocumentThemeIsDark()
  const state = useMermaidRender(code, isDark)

  if (state.status === "loading") {
    return <MermaidSkeleton />
  }
  if (state.status === "error") {
    return <MermaidFallback code={code} message={state.message} />
  }
  return (
    <div
      className="my-6 flex justify-center overflow-x-auto rounded-md border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      // securityLevel: "strict" でmermaidに描画させているためscript/on属性を含まない
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
}
