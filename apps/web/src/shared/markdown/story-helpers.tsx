import type { Decorator } from "@storybook/react-vite"
import { useEffect, type ReactNode } from "react"

export type MarkdownTheme = "light" | "dark"

/**
 * a11yアドオンが同一idの重複(脚注idなど)を誤検知しないよう、light/darkは
 * 同じstoryを2つ並べるのではなく別々のstory exportに分ける。
 *
 * `Mermaid`は`document.documentElement`のclassを直接見て再描画するため
 * (`hooks/use-document-theme.ts`)、CSSカスケード用に`.dark`を付けた
 * wrapper divを用意するだけでなく、`<html>`自体にも`.dark`を反映する。
 */
function MarkdownThemeFrame({
  theme,
  children,
}: {
  readonly theme: MarkdownTheme
  readonly children: ReactNode
}) {
  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains("dark")
    root.classList.toggle("dark", theme === "dark")
    return () => {
      root.classList.toggle("dark", hadDark)
    }
  }, [theme])

  return (
    <div
      className={
        theme === "dark"
          ? "dark min-w-0 rounded-md bg-background p-6 text-foreground"
          : "min-w-0 rounded-md bg-background p-6 text-foreground"
      }
    >
      {children}
    </div>
  )
}

export const markdownThemeDecorator: Decorator = (Story, context) => {
  const theme = (context.parameters.markdownTheme as MarkdownTheme) ?? "light"
  return (
    <MarkdownThemeFrame theme={theme}>
      <Story />
    </MarkdownThemeFrame>
  )
}

/** `markdown`/`baseUrl` argsとlight/dark parameterをまとめて作るヘルパー。 */
export function markdownStory(
  markdown: string,
  theme: MarkdownTheme = "light",
  baseUrl?: string
) {
  return {
    args: { markdown, baseUrl },
    parameters: { markdownTheme: theme },
  }
}
