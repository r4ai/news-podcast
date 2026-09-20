import { toHtml } from "hast-util-to-html"
import { defaultHandlers, type Handle } from "hast-util-to-mdast"
import rehypeParse from "rehype-parse"
import rehypeRemark from "rehype-remark"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import type { Element, Root as HastRoot } from "hast"
import type { Code, Link, Root as MdastRoot } from "mdast"
import type { Schema } from "hast-util-sanitize"

const textContent = (element: Element): string => {
  const values: string[] = []
  const stack = [...element.children].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "text") values.push(node.value)
    else if ("children" in node) stack.push(...[...node.children].reverse())
  }
  return values.join("")
}

const preHandler: Handle = (state, element) => {
  const result = defaultHandlers.pre(state, element) as Code
  const meta = element.properties.dataArticleCodeMeta
  result.meta = typeof meta === "string" && meta !== "" ? meta : null
  return result
}

const mathKindOf = (element: Element): "math" | "inlineMath" | undefined => {
  const classes = element.properties.className
  if (!Array.isArray(classes)) return undefined
  if (classes.includes("language-math")) return "math"
  if (classes.includes("language-math-inline")) return "inlineMath"
  return undefined
}

const codeHandler: Handle = (state, element) => {
  const type = mathKindOf(element)
  return type
    ? { type, value: textContent(element) }
    : defaultHandlers.code(state, element)
}

const anchorHandler: Handle = (state, element) => {
  if (element.properties.href === "")
    return {
      type: "link",
      url: "",
      children: state.all(element) as Link["children"],
    }
  return defaultHandlers.a(state, element)
}

// Only structural tags are emitted as HTML; body content still uses the shared
// Markdown handlers, preserving nested callouts, code, math and embeds.
const detailsHandler: Handle = (state, element) => [
  {
    type: "html",
    value: element.properties.open ? "<details open>" : "<details>",
  },
  ...state.all(element),
  { type: "html", value: "</details>" },
]
const summaryHandler: Handle = (_state, element) => {
  // Raw HTML bypasses codeHandler. Translate the same math source markers to
  // the renderer's math HTML vocabulary, including math nested in emphasis.
  const summary = structuredClone(element)
  const stack = [summary]
  while (stack.length > 0) {
    const node = stack.pop()!
    const math = node.tagName === "code" ? mathKindOf(node) : undefined
    if (math) {
      node.tagName = math === "math" ? "div" : "span"
      node.properties = {
        className: [math === "math" ? "math-display" : "math-inline"],
      }
    }
    for (const child of node.children)
      if (child.type === "element") stack.push(child)
  }
  return { type: "html", value: toHtml(summary) }
}

const defaultAttributes = defaultSchema.attributes!

const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultAttributes,
    pre: ["dataArticleCodeMeta"],
    code: [
      ...defaultAttributes.code!,
      ["className", /^language-./] as [string, RegExp],
    ],
    a: [...defaultAttributes.a!, "dataArticleDirective"],
  },
}

const htmlParser = unified().use(rehypeParse, { fragment: true })
const sanitizer = unified().use(rehypeSanitize, sanitizeSchema)
const markdownProcessor = unified()
  .use(rehypeRemark, {
    handlers: {
      a: anchorHandler,
      pre: preHandler,
      code: codeHandler,
      details: detailsHandler,
      summary: summaryHandler,
    },
  })
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkStringify, { bullet: "-", fences: true })

export const parseArticleHtml = (html: string): HastRoot =>
  htmlParser.parse(html) as HastRoot

export const sanitizeArticleHast = (tree: HastRoot): HastRoot =>
  sanitizer.runSync(tree) as HastRoot

export const toMarkdownTree = (tree: HastRoot): MdastRoot =>
  markdownProcessor.runSync(tree) as MdastRoot

export const stringifyMarkdown = (tree: MdastRoot): string =>
  markdownProcessor
    .stringify(tree)
    .replace(/^> \\\[!([a-z][a-z0-9-]*)\]([+-])?/gim, "> [!$1]$2")
