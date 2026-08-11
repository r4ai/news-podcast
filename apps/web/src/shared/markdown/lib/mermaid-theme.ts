export type CssTokenReader = (name: string) => string

/**
 * mermaidの`theme: 'base'`用themeVariablesを、現在解決済みのCSSトークンから
 * 組み立てる。`readToken`は呼び出し側が`getComputedStyle`などから注入する
 * ので、この関数自体はDOMに触れずテストできる。
 */
export function buildMermaidThemeVariables(
  readToken: CssTokenReader
): Record<string, string> {
  const color = (name: string) => toMermaidColor(readToken(name))
  const background = color("background")
  const foreground = color("foreground")
  const border = color("border")
  const muted = color("muted")
  const mutedForeground = color("muted-foreground")
  const accent = color("accent")
  const accentForeground = color("accent-foreground")
  const destructive = color("destructive")

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

// Mermaid 11の色parserはCSS Color 4のOKLCHを受理しないため、Tailwindの
// semantic tokenをsRGBへ変換してから渡す。その他の色形式はそのまま通す。
export function toMermaidColor(color: string): string {
  const parsed = parseOklch(color)
  if (!parsed) return color

  const hueRadians = (parsed.hue * Math.PI) / 180
  const a = parsed.chroma * Math.cos(hueRadians)
  const b = parsed.chroma * Math.sin(hueRadians)
  const lRoot = parsed.lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b
  const mRoot = parsed.lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b
  const sRoot = parsed.lightness - 0.089_484_177_5 * a - 1.291_485_548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  const red = toSrgb(
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s
  )
  const green = toSrgb(
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
  )
  const blue = toSrgb(
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
  )
  const channels = [red, green, blue].map((value) =>
    Math.round(clamp(value) * 255)
  )

  if (parsed.alpha < 1) {
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${parsed.alpha})`
  }
  return `#${channels.map(toHexByte).join("")}`
}

function parseOklch(color: string):
  | {
      readonly lightness: number
      readonly chroma: number
      readonly hue: number
      readonly alpha: number
    }
  | undefined {
  const match = color.match(
    /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/i
  )
  if (!match) return undefined
  const lightness = Number(match[1]) / (match[2] ? 100 : 1)
  const chroma = Number(match[3])
  const hue = Number(match[4])
  const alpha = match[5] ? Number(match[5]) / (match[6] ? 100 : 1) : 1
  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return undefined
  return {
    lightness: clamp(lightness),
    chroma: Math.max(0, chroma),
    hue,
    alpha: clamp(alpha),
  }
}

function toSrgb(linear: number): number {
  return linear <= 0.003_130_8
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0")
}
