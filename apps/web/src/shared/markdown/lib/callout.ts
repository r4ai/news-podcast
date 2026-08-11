export const CALLOUT_TYPES = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

export function isCalloutType(value: string): value is CalloutType {
  return (CALLOUT_TYPES as readonly string[]).includes(value)
}

const MARKER_PATTERN = /^\[!(note|tip|important|warning|caution)\]\s?/i

/** 段落先頭のテキストが `[!NOTE]` のようなcallout標識かどうかを判定する。 */
export function matchCalloutMarker(
  text: string
): { readonly type: CalloutType; readonly rest: string } | undefined {
  const match = MARKER_PATTERN.exec(text)
  if (!match) {
    return undefined
  }
  const type = match[1]?.toLowerCase()
  if (!type || !isCalloutType(type)) {
    return undefined
  }
  return { type, rest: text.slice(match[0].length) }
}
