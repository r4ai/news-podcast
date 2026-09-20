import type { Link, Paragraph, Root, Text } from "mdast"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

import { parseLinkCardMetadata } from "../lib/link-card"

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
    const card =
      directive.kind === "card"
        ? parseLinkCardMetadata(directive.link.title)
        : {}
    paragraph.children = []
    paragraph.data = {
      ...paragraph.data,
      hName:
        directive.kind === "embed" ? "markdown-embed" : "markdown-link-card",
      hProperties: {
        dataEmbedUrl: directive.link.url,
        dataCardTitle: card.title,
        dataCardDescription: card.description,
        dataCardImage: card.image,
        dataCardFavicon: card.favicon,
        dataEmbedFallback: directive.link.title ?? directive.link.url,
      },
    }
  })
}
