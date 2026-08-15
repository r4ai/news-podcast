import type { FeatureRule } from "../core/contracts.js"

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

export const safeUrlShapeRule: FeatureRule = {
  id: "safe-url-shape",
  phase: "preserve",
  transform(context, root) {
    let count = 0
    root.querySelectorAll("a[href]").forEach((anchor) => {
      try {
        const url = new URL(anchor.getAttribute("href")!, context.sourceUrl)
        if (SAFE_LINK_PROTOCOLS.has(url.protocol)) return
      } catch {
        // Invalid links use the same inert representation as blocked protocols.
      }
      anchor.setAttribute("href", "")
      count += 1
    })
    return count
  },
}
