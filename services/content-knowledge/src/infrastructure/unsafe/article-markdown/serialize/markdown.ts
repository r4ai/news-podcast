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

const codeHandler: Handle = (state, element, _parent) => {
  const classes = Array.isArray(element.properties.className)
    ? element.properties.className.map(String)
    : []
  if (classes.includes("language-math"))
    return { type: "math", value: textContent(element) }
  if (classes.includes("language-math-inline"))
    return { type: "inlineMath", value: textContent(element) }
  return defaultHandlers.code(state, element)
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
    handlers: { a: anchorHandler, pre: preHandler, code: codeHandler },
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
