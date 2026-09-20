import type { FeatureRule, RuleContext } from "../../core/contracts.js"

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

// Decode source payloads before the generic iframe rule discards their attributes.
const preserveEncodedEmbeds = (
  context: RuleContext,
  root: ParentNode
): number => {
  let count = 0
  for (const hint of context.profile?.encodedEmbeds ?? []) {
    for (const container of root.querySelectorAll(hint.selector)) {
      const frame = container.querySelector("iframe[data-content]")
      if (!frame) continue
      let source: string
      try {
        source = decodeURIComponent(frame.getAttribute("data-content")!)
      } catch {
        continue
      }
      if (!source.trim()) continue
      if (hint.kind === "mermaid") {
        const pre = container.ownerDocument.createElement("pre")
        const code = container.ownerDocument.createElement("code")
        code.className = "language-mermaid"
        code.textContent = source
        pre.append(code)
        container.replaceWith(pre)
      } else {
        const url = normalizeUrl(source, context.sourceUrl)
        if (!url) continue
        // Zenn emits a hidden sibling link for clients without JavaScript.
        const fallback = container.nextElementSibling
        if (
          fallback?.matches("a[href]") &&
          (fallback as HTMLAnchorElement).style.display === "none" &&
          normalizeUrl(fallback.getAttribute("href")!, context.sourceUrl) ===
            url
        )
          fallback.remove()
        directiveLink(
          container,
          hint.kind,
          url,
          hint.kind === "embed" ? url : undefined
        )
      }
      count += 1
    }
  }
  return count
}

export const embedRule: FeatureRule = {
  id: "embed",
  phase: "preserve",
  transform(context, root) {
    let count = preserveEncodedEmbeds(context, root)
    root.querySelectorAll("iframe[src]").forEach((iframe) => {
      const src = normalizeUrl(iframe.getAttribute("src")!, context.sourceUrl)
      if (!src) return
      directiveLink(iframe, "embed", src, context.sourceUrl.href)
      count += 1
    })
    root.querySelectorAll(CARD_SELECTORS).forEach((anchor) => {
      if (!anchor.isConnected || anchor.hasAttribute("data-article-directive"))
        return
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
