import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react"

import { cn } from "@workspace/ui/lib/utils"

import { parseLineNumberList } from "../../lib/diff-lines"
import { extractPlainText } from "../../lib/extract-text"
import {
  decorateLine,
  languageFromClassName,
  lineDecorationClassName,
  splitCodeLines,
  type LineDecorationContext,
} from "../../lib/code-lines"
import { parseLineRanges } from "../../lib/line-ranges"
import { CopyButton } from "./copy-button"
import { ShikiThemeStyle } from "./shiki-theme-style"

type CodeElementProps = {
  readonly className?: string
  readonly children?: ReactNode
}

export type CodeBlockProps = ComponentPropsWithoutRef<"pre"> & {
  readonly title?: string
  readonly highlight?: string
  readonly diffAdd?: string
  readonly diffRemove?: string
  readonly "data-raw-code"?: string
}

function findCodeElement(
  children: ReactNode
): ReactElement<CodeElementProps> | undefined {
  const [only] = Children.toArray(children)
  return isValidElement<CodeElementProps>(only) ? only : undefined
}

function isShikiOutput(className: string | undefined): boolean {
  return className?.split(/\s+/).includes("shiki") ?? false
}

/** 1行分の行番号ガター付き行を組み立てる。 */
function renderRow(
  lineNumber: number,
  rawLine: string | undefined,
  content: ReactNode,
  context: LineDecorationContext
): ReactNode {
  const decoration = decorateLine(lineNumber, rawLine, context)
  return (
    <span
      className={cn(
        "grid grid-cols-[2.5rem_1fr] gap-3 px-4",
        lineDecorationClassName(decoration)
      )}
      data-diff={decoration.diff}
      key={lineNumber}
    >
      <span
        aria-hidden="true"
        className="select-none text-right text-muted-foreground/70"
      >
        {lineNumber}
      </span>
      <span className="min-w-0">{content}</span>
    </span>
  )
}

/** Shikiが生成した `.line` spanを行番号ガター付きの行へ組み替える。 */
function buildShikiRows(
  codeChildren: ReactNode,
  rawLines: readonly string[],
  context: LineDecorationContext
): ReactNode[] {
  const rows: ReactNode[] = []
  let lineNumber = 0
  for (const child of Children.toArray(codeChildren)) {
    if (!isValidElement<CodeElementProps>(child)) {
      continue
    }
    lineNumber += 1
    rows.push(
      renderRow(
        lineNumber,
        rawLines[lineNumber - 1],
        child.props.children,
        context
      )
    )
  }
  return rows
}

/** 言語未対応/未指定のフォールバック時に、生テキストから行を組み立てる。 */
function buildPlainRows(
  rawLines: readonly string[],
  context: LineDecorationContext
): ReactNode[] {
  return rawLines.map((rawLine, index) =>
    renderRow(index + 1, rawLine, rawLine.length > 0 ? rawLine : "​", context)
  )
}

/**
 * fenced code blockの表示を担う。行番号は常に表示し、diff注記や
 * `{1,3-5}` によるハイライト行はmetaがある時だけ効く。
 * Shikiが処理できなかった言語(未知語・言語なし)でもエラーにせず
 * プレーンな行へフォールバックする。
 */
export function CodeBlock({
  children,
  className,
  style,
  title,
  highlight,
  diffAdd,
  diffRemove,
  "data-raw-code": rawCodeProp,
  ...rest
}: CodeBlockProps) {
  const codeElement = findCodeElement(children)
  const codeClassName = codeElement?.props.className
  const lang = languageFromClassName(codeClassName)
  const shiki = isShikiOutput(className)
  const rawCode = rawCodeProp ?? extractPlainText(children)
  const rawLines = splitCodeLines(rawCode)
  const context: LineDecorationContext = {
    lang,
    highlighted: parseLineRanges(highlight),
    added: parseLineNumberList(diffAdd),
    removed: parseLineNumberList(diffRemove),
  }
  const rows =
    shiki && codeElement
      ? buildShikiRows(codeElement.props.children, rawLines, context)
      : buildPlainRows(rawLines, context)

  return (
    <div className="my-4 overflow-hidden rounded-md border border-border bg-card text-card-foreground">
      <ShikiThemeStyle />
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{title ?? lang ?? "text"}</span>
        <CopyButton text={rawCode} />
      </div>
      <pre
        className={cn(
          "markdown-shiki overflow-x-auto py-3 font-mono text-sm leading-6",
          className
        )}
        style={style as CSSProperties}
        {...rest}
      >
        <code className="grid">{rows}</code>
      </pre>
    </div>
  )
}
