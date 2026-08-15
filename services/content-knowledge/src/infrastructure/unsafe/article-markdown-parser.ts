import { deepFreeze } from "@news-podcast/kernel"
import { toHtml } from "hast-util-to-html"
import rehypeParse from "rehype-parse"
import rehypeRemark from "rehype-remark"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import type { Element, Root as HastRoot } from "hast"
import type { Root as MdastRoot } from "mdast"

import type { CaptureError } from "../../application/ports/archive.js"

export type ArticleArchiveArtifacts = Readonly<{
  readonly markdown: Uint8Array
  readonly replay: Uint8Array
}>

export const MAXIMUM_ARTICLE_PARSER_INPUT_BYTES = 1_048_576
export const MAXIMUM_ARTICLE_MARKDOWN_BYTES = 1_048_576
export const MAXIMUM_ARTICLE_AST_NODES = 50_000
export const MAXIMUM_ARTICLE_AST_DEPTH = 128

const failure = (reason: CaptureError["reason"]): CaptureError =>
  deepFreeze({ _tag: "CaptureFailed", reason })

const isCaptureFailure = (value: unknown): value is CaptureError =>
  typeof value === "object" &&
  value !== null &&
  (value as { _tag?: unknown })._tag === "CaptureFailed"

const htmlProcessor = unified().use(rehypeParse, { fragment: true })
const sanitizeProcessor = unified().use(rehypeSanitize)
const markdownProcessor = unified()
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", fences: true })

type AstNode = Readonly<{
  readonly type: string
  readonly children?: readonly AstNode[]
}>

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

const isVoidTag = (name: string): boolean =>
  name === "area" ||
  name === "base" ||
  name === "br" ||
  name === "col" ||
  name === "embed" ||
  name === "hr" ||
  name === "img" ||
  name === "input" ||
  name === "link" ||
  name === "meta" ||
  name === "param" ||
  name === "source" ||
  name === "track" ||
  name === "wbr"

/** Applies structural budgets before the full HTML parser/Markdown pipeline. */
const validateHtmlBudget = (html: string): void => {
  let nodeCount = 1
  let depth = 0
  let index = 0

  while (index < html.length) {
    const open = html.indexOf("<", index)
    if (open === -1) return

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4)
      if (end === -1) throw failure("MalformedResponse")
      nodeCount += 1
      if (nodeCount > MAXIMUM_ARTICLE_AST_NODES) throw failure("ResourceLimit")
      index = end + 3
      continue
    }

    if (html.startsWith("<![CDATA[", open)) {
      const end = html.indexOf("]]>", open + 9)
      if (end === -1) throw failure("MalformedResponse")
      nodeCount += 1
      if (nodeCount > MAXIMUM_ARTICLE_AST_NODES) throw failure("ResourceLimit")
      index = end + 3
      continue
    }

    const marker = html.charCodeAt(open + 1)
    if (marker === 0x21 || marker === 0x3f) {
      const end = findTagEnd(html, open + 2)
      if (end === -1) throw failure("MalformedResponse")
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
    ) {
      nameEnd += 1
    }
    const end = findTagEnd(html, nameEnd)
    if (end === -1) throw failure("MalformedResponse")

    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES) throw failure("ResourceLimit")
    if (closing) {
      depth = Math.max(0, depth - 1)
    } else {
      let beforeEnd = end - 1
      while (
        beforeEnd >= nameEnd &&
        (html.charCodeAt(beforeEnd) === 0x20 ||
          html.charCodeAt(beforeEnd) === 0x09 ||
          html.charCodeAt(beforeEnd) === 0x0a ||
          html.charCodeAt(beforeEnd) === 0x0d)
      ) {
        beforeEnd -= 1
      }
      const selfClosing = html.charCodeAt(beforeEnd) === 0x2f
      const tagName = html.slice(nameStart, nameEnd).toLowerCase()
      if (!selfClosing && !isVoidTag(tagName)) {
        depth += 1
        if (depth > MAXIMUM_ARTICLE_AST_DEPTH) throw failure("ResourceLimit")
      }
    }
    index = end + 1
  }
}

const validateHastTree = (tree: HastRoot): void => {
  let nodeCount = 1
  const stack = tree.children.map((node) => ({
    node: node as AstNode,
    depth: 1,
  }))

  while (stack.length > 0) {
    const current = stack.pop()!
    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES) throw failure("ResourceLimit")
    if (current.depth > MAXIMUM_ARTICLE_AST_DEPTH)
      throw failure("ResourceLimit")
    for (const child of current.node.children ?? []) {
      stack.push({ node: child, depth: current.depth + 1 })
    }
  }
}

const resolveUrl = (
  node: Element,
  property: "href" | "src",
  baseUrl: string
) => {
  const value = node.properties[property]
  if (typeof value !== "string" || value === "") return
  try {
    node.properties[property] = new URL(value, baseUrl).href
  } catch {
    // Sanitization already removed unsafe URLs; invalid values remain unchanged.
  }
}

const resolveArticleUrls = (tree: HastRoot, sourceUrl: string): void => {
  const stack = [...tree.children]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "element") {
      if (node.tagName === "a") resolveUrl(node, "href", sourceUrl)
      if (node.tagName === "img" || node.tagName === "source")
        resolveUrl(node, "src", sourceUrl)
    }
    if ("children" in node) stack.push(...node.children)
  }
}

type MarkdownNode = Readonly<{
  readonly type: string
  readonly value?: string
  readonly children?: readonly MarkdownNode[]
}>

type HeadingNode = { type: string; depth?: number; children?: unknown[] }

const forEachHeading = (
  tree: MdastRoot,
  visit: (heading: HeadingNode) => void
): void => {
  const stack: HeadingNode[] = [...(tree.children as unknown as HeadingNode[])]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "heading" && typeof node.depth === "number") visit(node)
    if (Array.isArray(node.children))
      stack.push(...(node.children as HeadingNode[]))
  }
}

/**
 * 見出しを、最も浅いものがlevel 1になる正規形へ畳む。
 *
 * 保存するMarkdownは取得元ページの断片で、`<h2>`から始まるサイトもあれば
 * `<h1>`から始まるサイトもある。埋め込み先の見出し階層は保存時点では
 * 決まらないので、ここでは相対関係だけを残し、実レベルは表示側へ委ねる。
 * 相対関係を壊さないよう、全体を同じ量だけ持ち上げる (個別に詰めない)。
 */
const normalizeHeadingDepths = (tree: MdastRoot): void => {
  let shallowest = 7
  forEachHeading(tree, (heading) => {
    shallowest = Math.min(shallowest, heading.depth!)
  })
  const shift = shallowest - 1
  if (shift <= 0) return
  forEachHeading(tree, (heading) => {
    heading.depth = Math.max(1, heading.depth! - shift)
  })
}

const validateMarkdownTree = (tree: MdastRoot): void => {
  let nodeCount = 0
  let hasMeaningfulContent = false
  const visit = (node: MarkdownNode, depth: number): void => {
    nodeCount += 1
    if (nodeCount > MAXIMUM_ARTICLE_AST_NODES) throw failure("ResourceLimit")
    if (depth > MAXIMUM_ARTICLE_AST_DEPTH) throw failure("ResourceLimit")
    if (node.type === "text") {
      if (node.value?.trim() !== "") hasMeaningfulContent = true
    } else if (node.children !== undefined) {
      for (const child of node.children) visit(child, depth + 1)
    } else if (node.type !== "root") {
      hasMeaningfulContent = true
    }
  }
  visit(tree as unknown as MarkdownNode, 0)
  if (!hasMeaningfulContent) throw failure("MalformedResponse")
}

/** Parses untrusted HTML into ASTs before sanitizing and serializing Markdown. */
export const createArticleArchiveArtifacts = (
  raw: Uint8Array,
  sourceUrl: string
): ArticleArchiveArtifacts => {
  if (raw.byteLength > MAXIMUM_ARTICLE_PARSER_INPUT_BYTES)
    throw failure("ResourceLimit")

  let html: string
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(raw)
  } catch {
    throw failure("MalformedResponse")
  }
  validateHtmlBudget(html)

  let hast: HastRoot
  try {
    hast = htmlProcessor.parse(html) as HastRoot
  } catch {
    throw failure("MalformedResponse")
  }
  validateHastTree(hast)

  let tree: MdastRoot
  try {
    const sanitizedHast = sanitizeProcessor.runSync(hast) as HastRoot
    resolveArticleUrls(sanitizedHast, sourceUrl)
    tree = markdownProcessor.runSync(sanitizedHast) as MdastRoot
  } catch (error) {
    if (isCaptureFailure(error)) throw error
    throw failure("MalformedResponse")
  }
  validateMarkdownTree(tree)
  normalizeHeadingDepths(tree)

  tree.children.push({
    type: "paragraph",
    children: [{ type: "text", value: `Source: ${sourceUrl}` }],
  })
  const markdownText = markdownProcessor.stringify(tree)
  const markdown = new TextEncoder().encode(markdownText)
  if (markdown.byteLength > MAXIMUM_ARTICLE_MARKDOWN_BYTES)
    throw failure("ResourceLimit")
  const replayTree: HastRoot = {
    type: "root",
    children: [
      { type: "doctype" },
      {
        type: "element",
        tagName: "meta",
        properties: { charSet: "utf-8" },
        children: [],
      },
      {
        type: "element",
        tagName: "meta",
        properties: {
          httpEquiv: ["Content-Security-Policy"],
          content: "default-src 'none'; style-src 'unsafe-inline'",
        },
        children: [],
      },
      {
        type: "element",
        tagName: "title",
        properties: {},
        children: [{ type: "text", value: "Archived article" }],
      },
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [{ type: "text", value: markdownText }],
      },
    ],
  }
  const replay = new TextEncoder().encode(toHtml(replayTree))
  return Object.freeze({ markdown, replay })
}
