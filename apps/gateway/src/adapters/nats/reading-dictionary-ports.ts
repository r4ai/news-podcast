import { parse } from "@news-podcast/kernel"
import { parseReadingDictionaryReply, subjects } from "@news-podcast/protocols"
import { Effect } from "effect"

import {
  ReadingDictionaryEntrySchema,
  ReadingDictionaryPageSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../application/ports.js"
import {
  normalizeProblem,
  resourceConflict,
  resourceNotFound,
  unavailable,
} from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 読み上げ辞書の登録・更新・削除。名寄せの衝突は409として保つ。
 */

type ReadingDictionaryPorts = Pick<
  GatewayPorts,
  | "listReadingDictionary"
  | "createReadingDictionary"
  | "updateReadingDictionary"
  | "deleteReadingDictionary"
>

type Headers = Parameters<GatewayPorts["listReadingDictionary"]>[0]

export const makeReadingDictionaryPorts = (
  transport: Transport
): ReadingDictionaryPorts => {
  const dictionaryRpc = (headers: Headers, payload: unknown) =>
    transport
      .ownerRpc(
        headers,
        subjects.production.readingDictionary,
        "episode-production",
        payload,
        parseReadingDictionaryReply
      )
      .pipe(Effect.mapError(normalizeProblem))

  return {
    listReadingDictionary: (headers) =>
      dictionaryRpc(headers, { operation: "List" }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Entries"
            ? parse(ReadingDictionaryPageSchema)({
                items: reply.entries,
                page: { hasMore: false },
              })
            : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    createReadingDictionary: ({ headers, payload }) =>
      dictionaryRpc(headers, { operation: "Create", ...payload }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Entry"
            ? parse(ReadingDictionaryEntrySchema)(reply.entry)
            : reply._tag === "Conflict"
              ? Effect.fail(resourceConflict())
              : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    updateReadingDictionary: ({ headers, id, payload }) =>
      dictionaryRpc(headers, {
        operation: "Update",
        id,
        patch: payload,
      }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Entry"
            ? parse(ReadingDictionaryEntrySchema)(reply.entry)
            : reply._tag === "NotFound"
              ? Effect.fail(resourceNotFound())
              : reply._tag === "Conflict"
                ? Effect.fail(resourceConflict())
                : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    deleteReadingDictionary: ({ headers, id }) =>
      dictionaryRpc(headers, { operation: "Delete", id }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Deleted"
            ? Effect.void
            : reply._tag === "NotFound"
              ? Effect.fail(resourceNotFound())
              : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
