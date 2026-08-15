import { JSDOM } from "jsdom"

export type ArticleDom = Readonly<{
  readonly document: Document
  close(): void
}>

/** The only DOM/runtime boundary. Scripts and external resources stay disabled. */
export const openArticleDom = (html: string, sourceUrl: URL): ArticleDom => {
  const dom = new JSDOM(html, {
    url: sourceUrl.href,
    contentType: "text/html",
  })
  return Object.freeze({
    document: dom.window.document,
    close: () => dom.window.close(),
  })
}
