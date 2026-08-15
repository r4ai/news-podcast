import type { FeatureRule, RuleContext } from "../../core/contracts.js"

type CalloutMatch = Readonly<{
  readonly element: Element
  readonly type: string
}>

const genericType = (element: Element): string | undefined => {
  const explicit = element.getAttribute("data-callout-type")
  if (explicit) return explicit.toLowerCase()
  return Array.from(element.classList).find((value) => value !== "custom-block")
}

const collectCallouts = (
  context: RuleContext,
  root: ParentNode
): readonly CalloutMatch[] => {
  const found = new Map<Element, string>()
  for (const hint of context.profile?.callouts ?? [])
    root.querySelectorAll(hint.selector).forEach((element) => {
      if (!found.has(element)) found.set(element, hint.type)
    })
  root
    .querySelectorAll("[data-callout-type], .custom-block")
    .forEach((element) => {
      const type = genericType(element)
      if (type && !found.has(element)) found.set(element, type)
    })
  return Array.from(found, ([element, type]) => ({ element, type }))
}

const convertCallout = ({ element, type }: CalloutMatch): void => {
  const document = element.ownerDocument
  const quote = document.createElement("blockquote")
  const titleElement = element.querySelector(
    "[data-callout-title], .custom-block-title, .msg-title"
  )
  const title = titleElement?.textContent?.trim()
  titleElement?.remove()
  const folded = element.matches(
    "details:not([open]), [data-callout-folded=true]"
  )
  const foldMarker = element.matches("details, [data-callout-foldable=true]")
    ? folded
      ? "-"
      : "+"
    : ""
  const marker = document.createElement("p")
  marker.textContent = `[!${type}]${foldMarker}${title ? ` ${title}` : ""}`
  quote.append(marker, ...Array.from(element.childNodes))
  element.replaceWith(quote)
}

export const calloutRule: FeatureRule = {
  id: "callout",
  phase: "preserve",
  transform(context, root) {
    const callouts = collectCallouts(context, root)
    callouts.forEach(convertCallout)
    return callouts.length
  },
}
