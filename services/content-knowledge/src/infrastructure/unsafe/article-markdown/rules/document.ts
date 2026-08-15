import type { Element, Root as HastRoot } from "hast"
import type { Root as MdastRoot } from "mdast"

type HeadingNode = { type: string; depth?: number; children?: HeadingNode[] }

const visitHeadings = (
  tree: MdastRoot,
  visit: (heading: HeadingNode) => void
): void => {
  const stack = [...(tree.children as unknown as HeadingNode[])]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "heading" && typeof node.depth === "number") visit(node)
    if (node.children) stack.push(...node.children)
  }
}

export const normalizeHeadingDepths = (tree: MdastRoot): void => {
  let shallowest = 7
  visitHeadings(tree, (heading) => {
    shallowest = Math.min(shallowest, heading.depth!)
  })
  const shift = shallowest - 1
  if (shift <= 0) return
  visitHeadings(tree, (heading) => {
    heading.depth = Math.max(1, heading.depth! - shift)
  })
}

const resolveUrl = (
  node: Element,
  property: "href" | "src",
  baseUrl: URL
): void => {
  const value = node.properties[property]
  if (typeof value !== "string" || value === "") return
  try {
    node.properties[property] = new URL(value, baseUrl).href
  } catch {
    // Invalid values stay inert after sanitization.
  }
}

export const resolveArticleUrls = (tree: HastRoot, sourceUrl: URL): void => {
  const stack = [...tree.children]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "element") {
      if (node.tagName === "a") {
        if (node.properties.href === undefined) node.properties.href = ""
        resolveUrl(node, "href", sourceUrl)
      }
      if (node.tagName === "img" || node.tagName === "source")
        resolveUrl(node, "src", sourceUrl)
    }
    if ("children" in node) stack.push(...node.children)
  }
}
