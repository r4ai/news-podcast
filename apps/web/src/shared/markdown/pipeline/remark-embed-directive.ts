import type { Link, Paragraph, Root, Text } from "mdast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

type EmbedKind = "card" | "embed"

const directiveOf = (
  paragraph: Paragraph
): Readonly<{ kind: EmbedKind; link: Link }> | undefined => {
  const [prefix, link] = paragraph.children
  if (
    paragraph.children.length !== 2 ||
    prefix?.type !== "text" ||
    (prefix as Text).value !== "@" ||
    link?.type !== "link"
  )
    return undefined
  const label = link.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .toLowerCase()
  return label === "card" || label === "embed"
    ? { kind: label, link }
    : undefined
}

/** Converts the deliberately small `@[card|embed](url)` dialect to safe HAST. */
export const remarkEmbedDirective: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "paragraph", (paragraph: Paragraph) => {
    const directive = directiveOf(paragraph)
    if (!directive) return
    paragraph.children = []
    paragraph.data = {
      ...paragraph.data,
      hName:
        directive.kind === "embed" ? "markdown-embed" : "markdown-link-card",
      hProperties: {
        dataEmbedUrl: directive.link.url,
        dataEmbedFallback: directive.link.title ?? directive.link.url,
      },
    }
  })
}
