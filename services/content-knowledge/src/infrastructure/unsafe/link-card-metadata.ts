import { openArticleDom } from "./article-markdown/extract/dom.js"
import { validateHtmlBudget } from "./article-markdown/core/limits.js"
import type {
  LinkCardMetadata,
  LinkCardResolver,
} from "./article-markdown/rules/link-card.js"

export type LinkCardFetchOutcome = "succeeded" | "unavailable"

export const parseLinkCardMetadata = (
  html: string,
  base: URL
): LinkCardMetadata => {
  validateHtmlBudget(html)
  const dom = openArticleDom(html, base)
  try {
    const meta = (names: string[], limit: number) => {
      for (const name of names) {
        const value = dom.document
          .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
          ?.getAttribute("content")
          ?.trim()
        if (value) return value.slice(0, limit)
      }
      return undefined
    }
    const title =
      meta(["og:title", "twitter:title"], 256) ??
      (dom.document.title.trim().slice(0, 256) || base.hostname)
    const description = meta(
      ["og:description", "description", "twitter:description"],
      512
    )
    const candidate = meta(["og:image", "twitter:image"], 2048)
    let image: string | undefined
    try {
      if (candidate) {
        const url = new URL(candidate, base)
        if (
          ["https:", "http:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        )
          image = url.href
      }
    } catch {
      /* Invalid images leave a text card. */
    }
    return {
      title,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
    }
  } finally {
    dom.close()
  }
}

/** Uses the archive's DNS-pinned fetcher, byte budget and cancellation boundary. */
export const createLinkCardResolver = (input: {
  fetcher: typeof fetch
  readResponse: (response: Response) => Promise<Uint8Array>
  signal: AbortSignal
  observe?: (outcome: LinkCardFetchOutcome) => void
}): LinkCardResolver => {
  let budget: AbortSignal | undefined
  return async (url) => {
    budget ??= AbortSignal.any([input.signal, AbortSignal.timeout(4_000)])
    let outcome: LinkCardFetchOutcome = "unavailable"
    try {
      budget.throwIfAborted()
      const response = await input.fetcher(url, {
        signal: budget,
        headers: {
          "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)",
          Accept: "text/html",
        },
      })
      if (
        !response.ok ||
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("text/html")
      ) {
        await response.body?.cancel()
        return undefined
      }
      const raw = await input.readResponse(response)
      const metadata = parseLinkCardMetadata(
        new TextDecoder("utf-8", { fatal: true }).decode(raw),
        new URL(response.url || url)
      )
      outcome = "succeeded"
      return metadata
    } catch {
      return undefined
    } finally {
      try {
        input.observe?.(outcome)
      } catch {
        /* Observability cannot fail capture. */
      }
    }
  }
}
