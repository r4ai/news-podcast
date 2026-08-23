import type { Observability } from "@news-podcast/observability"

import type { ArticleSearchIndexObserver } from "../application/article-search-index.js"

type SearchIndexTelemetry = Pick<Observability, "count" | "gauge" | "log">

/** Snapshot/body identifiers are deliberately excluded from telemetry payloads. */
export const makeArticleSearchIndexObserver = (
  observability: SearchIndexTelemetry
): ArticleSearchIndexObserver => ({
  indexed: () => {
    observability.count("article.search_body.index", 1, {
      result: "indexed",
    })
  },
  failed: ({ reason, attempt }) => {
    observability.count("article.search_body.index", 1, {
      result: "failed",
      reason,
    })
    observability.log({
      name: "article.search_body.index_failed",
      level: "warn",
      attributes: {
        reason,
        attempt,
      },
    })
  },
  backlog: ({ depth }) => {
    observability.gauge("article.search_body.queue.depth", depth)
  },
})
