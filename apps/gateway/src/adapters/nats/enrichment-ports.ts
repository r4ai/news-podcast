import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  parseContentPersonalizationReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"

import { EnrichQueueSchema } from "../../contract.js"
import type { GatewayPorts } from "../../application/ports.js"
import { forbidden, normalizeProblem, unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * AI補完キューの可視化と、その運用操作（再処理・日次枠のリセット）。
 */

type EnrichmentPorts = Pick<
  GatewayPorts,
  "getEnrichQueue" | "enrichReprocess" | "enrichResetDaily"
>

type Headers = Parameters<GatewayPorts["getEnrichQueue"]>[0]
type EnrichmentResetFailure =
  | ReturnType<typeof forbidden>
  | ReturnType<typeof unavailable>

// キューの項目は内部IDのままでは公開できないため、公開名と小文字語彙へ移す。
const toPublicQueueItem = (
  item: {
    readonly articleId: string
    readonly reason: "New" | "Reprocess"
    readonly status: "Queued" | "Processing" | "Succeeded" | "Failed"
  } & Readonly<Record<string, unknown>>
) => {
  const { articleId, ...rest } = item
  return {
    ...rest,
    feedItemId: articleId,
    reason: item.reason.toLowerCase(),
    status: item.status.toLowerCase(),
  }
}

export const makeEnrichmentPorts = (transport: Transport): EnrichmentPorts => {
  const personalizationRpc = (headers: Headers, payload: unknown) =>
    transport.ownerRpc(
      headers,
      subjects.content.personalization,
      "content-knowledge",
      payload,
      parseContentPersonalizationReply
    )

  return {
    getEnrichQueue: (headers) =>
      personalizationRpc(headers, { operation: "GetEnrichmentQueue" }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "EnrichmentQueue"
            ? parse(EnrichQueueSchema)({
                ...reply.queue,
                processing: reply.queue.processing.map(toPublicQueueItem),
                pending: {
                  ...reply.queue.pending,
                  items: reply.queue.pending.items.map(toPublicQueueItem),
                },
                failed: {
                  ...reply.queue.failed,
                  items: reply.queue.failed.items.map(toPublicQueueItem),
                },
                recent: reply.queue.recent.map(toPublicQueueItem),
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    enrichReprocess: (headers) =>
      personalizationRpc(headers, { operation: "ReprocessEnrichment" }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Enqueued"
            ? Effect.succeed(deepFreeze({ enqueued: reply.count }))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    // 日次枠は利用者の暦日で切るため、ゲートウェイの現在時刻から日付を渡す。
    enrichResetDaily: (headers) =>
      personalizationRpc(headers, {
        operation: "ResetDailyEnrichment",
        localDate: transport.now().slice(0, 10),
      }).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            { readonly message: "Daily enrichment usage reset" },
            EnrichmentResetFailure
          > => {
            if (reply._tag === "Reset")
              return Effect.succeed(
                deepFreeze({ message: "Daily enrichment usage reset" as const })
              )
            if (reply._tag === "Rejected" && reply.code === "FORBIDDEN")
              return Effect.fail(forbidden())
            return Effect.fail(unavailable())
          }
        ),
        Effect.mapError(
          (failure): EnrichmentResetFailure =>
            normalizeProblem(failure) as EnrichmentResetFailure
        )
      ),
  }
}
