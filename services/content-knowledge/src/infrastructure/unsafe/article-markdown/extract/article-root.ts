import type { SiteProfile } from "../core/contracts.js"
import { extractReadableArticle } from "./readability.js"

export const prependTitleIfMissing = (
  document: Document,
  html: string,
  title: string
): string => {
  if (!title) return html
  const container = document.createElement("div")
  container.innerHTML = html
  const firstHeading = container.querySelector("h1, h2, h3, h4, h5, h6")
  if (firstHeading?.textContent?.trim() === title) return container.innerHTML
  const heading = document.createElement("h1")
  heading.textContent = title
  container.prepend(heading)
  return container.innerHTML
}

export type ArticleRootResult = Readonly<{
  readonly html: string
  readonly usedProfileRoot: boolean
}>

export const extractArticleRoot = (
  document: Document,
  profile?: SiteProfile
): ArticleRootResult => {
  if (profile) {
    for (const selector of profile.remove)
      document.querySelectorAll(selector).forEach((node) => node.remove())
    const root = document.querySelector(profile.articleRoot)
    if (root)
      return Object.freeze({ html: root.innerHTML, usedProfileRoot: true })
  }

  const semanticArticles = document.querySelectorAll("article")
  if (semanticArticles.length === 1)
    return Object.freeze({
      html: semanticArticles[0]!.innerHTML,
      usedProfileRoot: false,
    })

  const readable = document.querySelector("article, main")
    ? extractReadableArticle(document)
    : undefined
  if (readable)
    return Object.freeze({
      html: prependTitleIfMissing(document, readable.content, readable.title),
      usedProfileRoot: false,
    })

  const fallback = document.querySelector("article, main") ?? document.body
  return Object.freeze({
    html: fallback.innerHTML,
    usedProfileRoot: false,
  })
}
