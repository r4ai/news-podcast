import { Readability } from "@mozilla/readability"

export type ReadableArticle = Readonly<{
  readonly title: string
  readonly content: string
}>

type ReadabilityResult = ReturnType<Readability["parse"]>

export const normalizeReadableArticle = (
  article: ReadabilityResult
): ReadableArticle | undefined => {
  if (!article) return undefined
  const content = article.content?.trim()
  if (!content) return undefined
  return Object.freeze({
    title: article.title ? article.title.trim() : "",
    content,
  })
}

export const extractReadableArticle = (
  document: Document
): ReadableArticle | undefined => {
  const clone = document.cloneNode(true) as Document
  return normalizeReadableArticle(
    new Readability(clone, { keepClasses: true }).parse()
  )
}
