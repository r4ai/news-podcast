import type { FeatureRule } from "../../core/contracts.js"

const CARD_SELECTORS =
  "a.embed-link, a.link-card, [data-content-type=card] a, .embed-block a"

const normalizeUrl = (value: string, base: URL): string | undefined => {
  try {
    const url = new URL(value, base)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

const directiveLink = (
  element: Element,
  kind: "card" | "embed",
  url: string,
  fallback?: string
): void => {
  const document = element.ownerDocument
  const paragraph = document.createElement("p")
  const link = document.createElement("a")
  link.href = url
  link.textContent = kind
  link.setAttribute("data-article-directive", kind)
  if (fallback) link.title = fallback
  paragraph.append("@", link)
  element.replaceWith(paragraph)
}

export const embedRule: FeatureRule = {
  id: "embed",
  phase: "preserve",
  transform(context, root) {
    let count = 0
    root.querySelectorAll("iframe[src]").forEach((iframe) => {
      const src = normalizeUrl(iframe.getAttribute("src")!, context.sourceUrl)
      if (!src) return
      directiveLink(iframe, "embed", src, context.sourceUrl.href)
      count += 1
    })
    root.querySelectorAll(CARD_SELECTORS).forEach((anchor) => {
      if (!anchor.isConnected) return
      const value = anchor.getAttribute("href")
      if (!value) return
      const href = normalizeUrl(value, context.sourceUrl)
      if (!href) return
      directiveLink(anchor.closest(".embed-block") ?? anchor, "card", href)
      count += 1
    })
    return count
  },
}
