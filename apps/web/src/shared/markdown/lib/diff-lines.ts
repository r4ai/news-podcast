export type DiffLineKind = "add" | "remove" | undefined

/** `// [!code ++]` 系の注記から取り除いた行番号(1始まり)をカンマ区切りにする。 */
export function parseLineNumberList(
  spec: string | undefined
): ReadonlySet<number> {
  const result = new Set<number>()
  if (!spec) {
    return result
  }
  for (const part of spec.split(",")) {
    const line = Number(part.trim())
    if (Number.isInteger(line) && line > 0) {
      result.add(line)
    }
  }
  return result
}

/**
 * 表示中の行が追加/削除行かどうかを判定する。
 * `lang="diff"` の場合は行頭の `+`/`-` を見る。それ以外は注記由来の行番号集合を見る。
 */
export function diffLineKind(params: {
  readonly lang: string | undefined
  readonly lineNumber: number
  readonly rawLine: string | undefined
  readonly added: ReadonlySet<number>
  readonly removed: ReadonlySet<number>
}): DiffLineKind {
  if (params.lang === "diff") {
    return diffLineKindFromPrefix(params.rawLine)
  }
  if (params.added.has(params.lineNumber)) {
    return "add"
  }
  if (params.removed.has(params.lineNumber)) {
    return "remove"
  }
  return undefined
}

function diffLineKindFromPrefix(rawLine: string | undefined): DiffLineKind {
  if (!rawLine) {
    return undefined
  }
  if (rawLine.startsWith("+")) {
    return "add"
  }
  if (rawLine.startsWith("-")) {
    return "remove"
  }
  return undefined
}
