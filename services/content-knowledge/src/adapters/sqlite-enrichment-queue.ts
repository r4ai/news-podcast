import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnrichmentQueueError,
  EnrichmentQueueRepository,
} from "../application/enrichment.js"
import { makeClaiming } from "./enrichment-queue/claiming.js"
import { makeCompletion } from "./enrichment-queue/completion.js"
import { makeEnqueueing } from "./enrichment-queue/enqueueing.js"
import { makeReporting } from "./enrichment-queue/reporting.js"
import { enrichmentQueueSchema, failure } from "./enrichment-queue/schema.js"
import type { SqlitePort } from "./sqlite-port.js"

/**
 * AI補完キューの合成点。スキーマを整えたうえで、
 * 取得・確定・再投入・可視化の各責務を1つのリポジトリとして束ねる。
 */

export const createSqliteEnrichmentQueue = (
  database: SqlitePort
): Effect.Effect<EnrichmentQueueRepository, EnrichmentQueueError> =>
  Effect.try({
    try: () => database.execute(enrichmentQueueSchema),
    catch: () => failure("Reconcile"),
  }).pipe(
    Effect.map(() =>
      deepFreeze({
        ...makeClaiming(database),
        ...makeCompletion(database),
        ...makeReporting(database),
        ...makeEnqueueing(database),
      } satisfies EnrichmentQueueRepository)
    )
  )
