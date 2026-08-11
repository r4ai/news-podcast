import { diffLineKind, type DiffLineKind } from "./diff-lines"

/** `language-xxx` クラスから言語名だけを取り出す。 */
export function languageFromClassName(
  className: string | undefined
): string | undefined {
  const token = className
    ?.split(/\s+/)
    .find((value) => value.startsWith("language-"))
  return token?.slice("language-".length)
}

/**
 * Shikiの `stripEndNewline` と同じ規則(末尾の改行を1つだけ取り除く)で
 * コード文字列を行配列に分割する。表示行と `data-raw-code` の行番号を
 * 一致させるために同じ規則を使う。
 */
export function splitCodeLines(code: string): readonly string[] {
  const stripped = code.endsWith("\n") ? code.slice(0, -1) : code
  return stripped === "" ? [] : stripped.split("\n")
}

export type LineDecoration = {
  readonly highlighted: boolean
  readonly diff: DiffLineKind
}

export type LineDecorationContext = {
  readonly lang: string | undefined
  readonly highlighted: ReadonlySet<number>
  readonly added: ReadonlySet<number>
  readonly removed: ReadonlySet<number>
}

/** 1行分の装飾(ハイライト行/diff行)を判定する純関数。 */
export function decorateLine(
  lineNumber: number,
  rawLine: string | undefined,
  context: LineDecorationContext
): LineDecoration {
  return {
    highlighted: context.highlighted.has(lineNumber),
    diff: diffLineKind({
      lang: context.lang,
      lineNumber,
      rawLine,
      added: context.added,
      removed: context.removed,
    }),
  }
}

/** 行の装飾から背景・左ボーダーのTailwindクラスを組み立てる。 */
export function lineDecorationClassName(
  decoration: LineDecoration
): string | undefined {
  if (decoration.diff === "add") {
    return "bg-accent/70 shadow-[inset_3px_0_0_0_var(--accent-foreground)]"
  }
  if (decoration.diff === "remove") {
    return "bg-destructive/10 shadow-[inset_3px_0_0_0_var(--destructive)]"
  }
  if (decoration.highlighted) {
    return "bg-muted shadow-[inset_3px_0_0_0_var(--foreground)]"
  }
  return undefined
}
