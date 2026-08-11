export type CssTokenReader = (name: string) => string

/**
 * mermaidの`theme: 'base'`用themeVariablesを、現在解決済みのCSSトークンから
 * 組み立てる。`readToken`は呼び出し側が`getComputedStyle`などから注入する
 * ので、この関数自体はDOMに触れずテストできる。
 */
export function buildMermaidThemeVariables(
  readToken: CssTokenReader
): Record<string, string> {
  const background = readToken("background")
  const foreground = readToken("foreground")
  const border = readToken("border")
  const muted = readToken("muted")
  const mutedForeground = readToken("muted-foreground")
  const accent = readToken("accent")
  const accentForeground = readToken("accent-foreground")
  const destructive = readToken("destructive")

  return {
    background,
    fontFamily: "inherit",
    textColor: foreground,
    lineColor: border,
    primaryColor: muted,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: accent,
    secondaryTextColor: accentForeground,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,
    mainBkg: muted,
    nodeBorder: border,
    clusterBkg: background,
    clusterBorder: border,
    edgeLabelBackground: background,
    noteBkgColor: muted,
    noteTextColor: mutedForeground,
    noteBorderColor: border,
    errorBkgColor: background,
    errorTextColor: destructive,
  }
}
