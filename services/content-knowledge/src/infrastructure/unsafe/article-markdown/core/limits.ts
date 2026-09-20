import { deepFreeze } from "@news-podcast/kernel"
import type { Root as HastRoot } from "hast"
import type { Root as MdastRoot } from "mdast"

import type { CaptureError } from "../../../../application/ports/archive.js"

export const MAXIMUM_ARTICLE_PARSER_INPUT_BYTES = 1_048_576
export const MAXIMUM_ARTICLE_MARKDOWN_BYTES = 1_048_576
export const MAXIMUM_ARTICLE_AST_NODES = 50_000
export const MAXIMUM_ARTICLE_AST_DEPTH = 128

type AstNode = Readonly<{
  readonly type: string
  readonly children?: readonly AstNode[]
}>

type MarkdownNode = Readonly<{
  readonly type: string
  readonly value?: string
  readonly children?: readonly MarkdownNode[]
}>

export const parserFailure = (reason: CaptureError["reason"]): CaptureError =>
  deepFreeze({ _tag: "CaptureFailed", reason })

export const isCaptureFailure = (value: unknown): value is CaptureError =>
  typeof value === "object" &&
  value !== null &&
  (value as { _tag?: unknown })._tag === "CaptureFailed"

const isAsciiLetter = (code: number): boolean =>
  (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)

const isTagNameStart = (code: number): boolean =>
  isAsciiLetter(code) || code === 0x3a || code === 0x5f

const isTagNameCharacter = (code: number): boolean =>
  isTagNameStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d

const findTagEnd = (html: string, start: number): number => {
  let quote = 0
  for (let index = start; index < html.length; index += 1) {
    const code = html.charCodeAt(index)
    if (quote !== 0) {
      if (code === quote) quote = 0
    } else if (code === 0x22 || code === 0x27) {
      quote = code
    } else if (code === 0x3e) {
      return index
    }
  }
  return -1
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

/** HTML以外の内容（SVG/MathML）へ切り替えるルート要素。 */
const FOREIGN_CONTENT_ROOTS = new Set(["svg", "math"])

/** 外来内容の中でHTMLパーサーへ戻る統合点（走査では小文字へ正規化済み）。 */
const HTML_INTEGRATION_POINTS = new Set([
  "foreignobject",
  "desc",
  "title",
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "annotation-xml",
])

/** Applies structural budgets before constructing a DOM from untrusted HTML. */
export const validateHtmlBudget = (html: string): void => {
  let nodeCount = 1
  const openElements: Array<{
    readonly name: string
    readonly foreign: boolean
  }> = []
  let index = 0

  while (index < html.length) {
    const open = html.indexOf("<", index)
    if (open === -1) return
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4)
      if (end === -1) throw parserFailure("MalformedResponse")
      nodeCount += 1
      if (nodeCount > MAXIMUM_ARTICLE_AST_NODES)
        throw parserFailure("ResourceLimit")
      index = end + 3
      continue
    }
    if (html.startsWith("<![CDATA[", open)) {
      const end = html.indexOf("]]>", open + 9)
      if (end === -1) throw parserFailure("MalformedResponse")
      nodeCount += 1
      if (nodeCount > MAXIMUM_ARTICLE_AST_NODES)
        throw parserFailure("ResourceLimit")
      index = end + 3
      continue
    }

    const marker = html.charCodeAt(open + 1)
    if (marker === 0x21 || marker === 0x3f) {
      const end = findTagEnd(html, open + 2)
      if (end === -1) throw parserFailure("MalformedResponse")
      index = end + 1
      continue
    }

    const closing = marker === 0x2f
    const nameStart = open + (closing ? 2 : 1)
    if (!isTagNameStart(html.charCodeAt(nameStart))) {
      index = open + 1
      continue
    }
    let nameEnd = nameStart + 1
    while (
      nameEnd < html.length &&
      isTagNameCharacter(html.charCodeAt(nameEnd))
    )
      nameEnd += 1
    const end = findTagEnd(html, nameEnd)
    if (end === -1) throw parserFailure("MalformedResponse")
    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES)
      throw parserFailure("ResourceLimit")
    if (closing) {
      // 対応する開始タグがない終了タグでは深さを減らさない。単純な
      // depth カウンターは不一致の終了タグで実DOMより浅く見積もるため、
      // 開始タグのスタックで照合する。
      const tagName = html.slice(nameStart, nameEnd).toLowerCase()
      let matchIndex = -1
      for (let i = openElements.length - 1; i >= 0; i -= 1) {
        if (openElements[i]!.name === tagName) {
          matchIndex = i
          break
        }
      }
      if (matchIndex !== -1) openElements.length = matchIndex
    } else {
      let beforeEnd = end - 1
      while (
        beforeEnd >= nameEnd &&
        [0x20, 0x09, 0x0a, 0x0d].includes(html.charCodeAt(beforeEnd))
      )
        beforeEnd -= 1
      const selfClosing = html.charCodeAt(beforeEnd) === 0x2f
      const tagName = html.slice(nameStart, nameEnd).toLowerCase()
      const foreign = openElements.at(-1)?.foreign ?? false

      let opens = false
      let entersForeign = foreign
      if (foreign) {
        // 外来内容では自己終了構文が有効。統合点だけHTMLへ戻る。
        if (HTML_INTEGRATION_POINTS.has(tagName)) {
          opens = !selfClosing
          entersForeign = false
        } else {
          opens = !selfClosing
        }
      } else if (FOREIGN_CONTENT_ROOTS.has(tagName)) {
        opens = !selfClosing
        entersForeign = true
      } else {
        opens = !VOID_TAGS.has(tagName)
      }

      if (opens) {
        openElements.push({ name: tagName, foreign: entersForeign })
        if (openElements.length > MAXIMUM_ARTICLE_AST_DEPTH)
          throw parserFailure("ResourceLimit")
      }
    }
    index = end + 1
  }
}

export const validateAstTree = (tree: HastRoot): void => {
  let nodeCount = 1
  const stack = tree.children.map((node) => ({
    node: node as AstNode,
    depth: 1,
  }))
  while (stack.length > 0) {
    const current = stack.pop()!
    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES)
      throw parserFailure("ResourceLimit")
    if (current.depth > MAXIMUM_ARTICLE_AST_DEPTH)
      throw parserFailure("ResourceLimit")
    for (const child of current.node.children ?? [])
      stack.push({ node: child, depth: current.depth + 1 })
  }
}

export const validateMarkdownTree = (tree: MdastRoot): void => {
  let nodeCount = 0
  let hasMeaningfulContent = false
  const visit = (node: MarkdownNode, depth: number): void => {
    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES)
      throw parserFailure("ResourceLimit")
    if (depth > MAXIMUM_ARTICLE_AST_DEPTH) throw parserFailure("ResourceLimit")
    if (node.type === "text") {
      if (node.value?.trim() !== "") hasMeaningfulContent = true
    } else if (node.children !== undefined) {
      for (const child of node.children) visit(child, depth + 1)
    } else if (node.type !== "root") {
      hasMeaningfulContent = true
    }
  }
  visit(tree as unknown as MarkdownNode, 0)
  if (!hasMeaningfulContent) throw parserFailure("MalformedResponse")
}
