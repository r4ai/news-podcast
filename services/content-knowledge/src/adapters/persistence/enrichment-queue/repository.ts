import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnrichmentQueueError,
  EnrichmentQueueRepository,
} from "../../../application/enrichment.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeClaiming } from "./claiming.js"
import { makeCompletion } from "./completion.js"
import { makeBudget } from "./budget.js"
import { makeEnqueueing } from "./enqueueing.js"
import { makeReporting } from "./reporting.js"

/**
 * AI補完キューの合成点。入口（回収・投入・取得）、出口（結果確定）、
 * 見える化（滞留・失敗・日次消費）を1つのリポジトリに束ねる。
 */
export const createEnrichmentQueue = (
  database: ContentKnowledgeDatabase
): Effect.Effect<EnrichmentQueueRepository, EnrichmentQueueError> =>
  Effect.sync(() =>
    deepFreeze({
      ...makeClaiming(database),
      ...makeBudget(database),
      ...makeEnqueueing(database),
      ...makeCompletion(database),
      ...makeReporting(database),
    } satisfies EnrichmentQueueRepository)
  )
