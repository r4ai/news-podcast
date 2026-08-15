/**
 * fenceのmeta文字列にある `{1,3-5}` 形式の行番号指定を解釈する。
 * 不正な指定は無視し、行番号は1始まりとして扱う。
 */
export function parseLineRanges(spec: string | undefined): ReadonlySet<number> {
  const result = new Set<number>()
  if (!spec) {
    return result
  }
  for (const part of spec.split(",")) {
    const trimmed = part.trim()
    if (trimmed === "") {
      continue
    }
    addRange(result, trimmed)
  }
  return result
}

function addRange(target: Set<number>, part: string): void {
  const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
  if (rangeMatch) {
    const start = Number(rangeMatch[1])
    const end = Number(rangeMatch[2])
    if (start > 0 && end > 0) addNumericRange(target, start, end)
    return
  }
  const singleMatch = /^\d+$/.exec(part)
  const value = Number(part)
  if (singleMatch && value > 0) target.add(value)
}

function addNumericRange(
  target: Set<number>,
  start: number,
  end: number
): void {
  const [from, to] = start <= end ? [start, end] : [end, start]
  for (let line = from; line <= to; line += 1) {
    target.add(line)
  }
}

/** fenceのmeta文字列から `{...}` のハイライト指定部分だけを取り出す。 */
export function extractHighlightSpec(
  meta: string | undefined
): string | undefined {
  if (!meta) {
    return undefined
  }
  const match = /\{([\d,\-\s]+)\}/.exec(meta)
  return match?.[1]?.trim()
}

/** fenceのmeta文字列から `title="..."` / `filename="..."` を取り出す。 */
export function extractTitle(meta: string | undefined): string | undefined {
  if (!meta) {
    return undefined
  }
  const match = /(?:title|filename)="([^"]+)"/.exec(meta)
  return match?.[1]
}

const namedMeta = (
  meta: string | undefined
): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}
  if (!meta) return values
  const pattern = /([A-Za-z][A-Za-z0-9]*)=(?:"([^"]*)"|([^\s]+))/g
  for (const match of meta.matchAll(pattern)) {
    values[match[1]!] = (match[2] ?? match[3])!
  }
  return values
}

export type CodeDisplayMeta = Readonly<{
  readonly title?: string
  readonly highlight?: string
  readonly diffAdd?: string
  readonly diffRemove?: string
  readonly showLineNumbers?: boolean
  readonly startLine?: number
}>

export const extractCodeDisplayMeta = (
  meta: string | undefined
): CodeDisplayMeta => {
  const values = namedMeta(meta)
  const startLine = Number(values.startLine)
  return {
    title: extractTitle(meta),
    highlight: values.highlight ?? extractHighlightSpec(meta),
    diffAdd: values.diffAdd,
    diffRemove: values.diffRemove,
    showLineNumbers:
      values.showLineNumbers === undefined
        ? undefined
        : values.showLineNumbers === "true",
    startLine:
      Number.isInteger(startLine) && startLine > 0 ? startLine : undefined,
  }
}
