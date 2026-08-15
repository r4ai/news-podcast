import type { FeatureRule } from "../core/contracts.js"

export const mathRule: FeatureRule = {
  id: "math",
  phase: "preserve",
  transform(_context, root) {
    const annotations = Array.from(
      root.querySelectorAll('annotation[encoding="application/x-tex"]')
    )
    for (const annotation of annotations) {
      const source = annotation.textContent?.trim()
      const container = annotation.closest(
        ".katex-display, .katex, mjx-container"
      )
      if (!source || !container) continue
      const code = annotation.ownerDocument.createElement("code")
      code.className = container.matches(
        ".katex-display, mjx-container[display=true]"
      )
        ? "language-math"
        : "language-math-inline"
      code.textContent = source
      container.replaceWith(code)
    }
    return annotations.length
  },
}
