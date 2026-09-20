import type { Link, Root } from "mdast"

export type LinkCardMetadata = Readonly<{
  title: string
  description?: string
  image?: string
}>
export type LinkCardResolver = (
  url: string
) => Promise<LinkCardMetadata | undefined>

/** Optional capture-time enrichment. Rendering never triggers an outbound scrape. */
export const enrichLinkCards = async (
  tree: Root,
  resolve: LinkCardResolver
): Promise<number> => {
  const cards: Link[] = []
  const stack = [...tree.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (node.type === "paragraph" && node.children.length === 2) {
      const [prefix, link] = node.children
      if (
        prefix?.type === "text" &&
        prefix.value === "@" &&
        link?.type === "link" &&
        link.children.length === 1 &&
        link.children[0]?.type === "text" &&
        link.children[0].value === "card"
      )
        cards.push(link)
    }
    if ("children" in node)
      stack.push(...[...(node.children as typeof stack)].reverse())
  }
  const urls = [...new Set(cards.map((link) => link.url))].slice(0, 12)
  const metadata = new Map<string, LinkCardMetadata>()
  for (let offset = 0; offset < urls.length; offset += 3) {
    await Promise.all(
      urls.slice(offset, offset + 3).map(async (url) => {
        try {
          const result = await resolve(url)
          if (result) metadata.set(url, result)
        } catch {
          /* A preview failure must not discard an article. */
        }
      })
    )
  }
  let count = 0
  for (const card of cards) {
    const preview = metadata.get(card.url)
    if (preview) {
      card.title = `link-card:v1:${JSON.stringify(preview)}`
      count += 1
    }
  }
  return count
}
