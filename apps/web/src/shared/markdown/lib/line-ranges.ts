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
    addNumericRange(target, Number(rangeMatch[1]), Number(rangeMatch[2]))
    return
  }
  const singleMatch = /^\d+$/.exec(part)
  if (singleMatch) {
    target.add(Number(part))
  }
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
