import type {
  FeatureRule,
  LanguageDetector,
  RuleContext,
} from "../../core/contracts.js"
import {
  firstExplicitLanguage,
  languageFromClassName,
  languageFromFilename,
  languageFromSourceHint,
} from "../../language/explicit.js"
import { detectLanguage } from "../../language/vscode-detector.js"
import { serializeCodeMetadata } from "./metadata.js"

const numericAttribute = (
  element: Element,
  names: readonly string[]
): number | undefined => {
  for (const name of names) {
    const value = Number(element.getAttribute(name))
    if (Number.isInteger(value) && value > 0) return value
  }
  return undefined
}

const linesOf = (code: Element): readonly Element[] =>
  Array.from(code.querySelectorAll(":scope > .line, :scope > code > .line"))

const sourceOf = (code: Element): string => {
  const lines = linesOf(code)
  return lines.length > 0
    ? lines.map((line) => line.textContent).join("\n")
    : code.textContent
}

const lineNumbersWith = (
  lines: readonly Element[],
  predicate: (line: Element) => boolean
): readonly number[] =>
  lines.flatMap((line, index) => (predicate(line) ? [index + 1] : []))

const closestWrapper = (pre: Element): Element =>
  pre.closest(".code-block-container, .code-frame, .code-wrapper") ??
  pre.closest(".highlight, figure.highlight") ??
  pre

const filenameOf = (
  wrapper: Element,
  selectors: readonly string[]
): string | undefined => {
  for (const selector of [
    ...selectors,
    ".code-title",
    ".code-filename",
    ".filename",
  ]) {
    const value = wrapper.querySelector(selector)?.textContent?.trim()
    if (value) return value
  }
  return undefined
}

const explicitLanguageOf = (
  pre: Element,
  code: Element,
  wrapper: Element
): string | undefined =>
  firstExplicitLanguage([
    wrapper.getAttribute("data-lang") ?? undefined,
    pre.getAttribute("data-language") ?? undefined,
    code.getAttribute("data-language") ?? undefined,
    languageFromClassName(code.className),
    languageFromClassName(pre.className),
  ])

const replaceCodeBlock = async (
  context: RuleContext,
  pre: Element,
  detector?: LanguageDetector
): Promise<void> => {
  const code = pre.querySelector("code") ?? pre
  const wrapper = closestWrapper(pre)
  const source = sourceOf(code)
  const filename = filenameOf(wrapper, context.profile?.filenameSelectors ?? [])
  const language =
    explicitLanguageOf(pre, code, wrapper) ??
    languageFromFilename(filename) ??
    languageFromSourceHint(source) ??
    (await detectLanguage(source, detector))
  const lines = linesOf(code)
  const metadata = serializeCodeMetadata({
    language,
    title: filename,
    showLineNumbers:
      wrapper.matches("[data-line-numbers], .line-numbers") ||
      wrapper.querySelector(".line-number") !== null,
    startLine: numericAttribute(wrapper, [
      "data-start-line",
      "data-line-start",
    ]),
    highlight: lineNumbersWith(lines, (line) =>
      line.matches(".highlighted, .highlight, [data-highlighted-line]")
    ),
    diffAdd: lineNumbersWith(lines, (line) =>
      line.matches(".diff.add, .add, .inserted")
    ),
    diffRemove: lineNumbersWith(lines, (line) =>
      line.matches(".diff.remove, .remove, .deleted")
    ),
  })

  const document = pre.ownerDocument
  const normalizedPre = document.createElement("pre")
  normalizedPre.setAttribute("data-article-code-meta", metadata)
  const normalizedCode = document.createElement("code")
  if (language) normalizedCode.className = `language-${language}`
  normalizedCode.textContent = source
  normalizedPre.append(normalizedCode)
  ;(wrapper === pre ? pre : wrapper).replaceWith(normalizedPre)
}

export const createCodeRule = (detector?: LanguageDetector): FeatureRule => ({
  id: "code-block",
  phase: "preserve",
  async transform(context, root) {
    const blocks = Array.from(root.querySelectorAll("pre"))
    for (const block of blocks) await replaceCodeBlock(context, block, detector)
    return blocks.length
  },
})
