import type { FeatureRule } from "../core/contracts.js"

export const mathRule: FeatureRule = {
  id: "math",
  phase: "preserve",
  transform(context, root) {
    let count = 0
    for (const hint of context.profile?.mathSources ?? []) {
      for (const element of root.querySelectorAll(hint.selector)) {
        const source = element.textContent?.trim()
        if (!source) continue
        const code = element.ownerDocument.createElement("code")
        code.className = hint.display ? "language-math" : "language-math-inline"
        code.textContent = source
        element.replaceWith(code)
        count += 1
      }
    }
    const annotations = Array.from(
      root.querySelectorAll('annotation[encoding="application/x-tex"]')
    )
    for (const annotation of annotations) {
      const source = annotation.textContent?.trim()
      const container =
        annotation.closest(".katex-display") ??
        annotation.closest(".katex-display, .katex, mjx-container")
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
    return count + annotations.length
  },
}
