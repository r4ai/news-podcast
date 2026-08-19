import { parse } from "@news-podcast/kernel"
import { parseReadingDictionaryReply, subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

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
type DictionaryReply = Effect.Success<
  ReturnType<typeof parseReadingDictionaryReply>
>
type DictionaryEntry = Schema.Schema.Type<typeof ReadingDictionaryEntrySchema>
type DictionaryPage = Schema.Schema.Type<typeof ReadingDictionaryPageSchema>
type UnavailableProblem = ReturnType<typeof unavailable>
type NotFoundProblem = ReturnType<typeof resourceNotFound>
type ConflictProblem = ReturnType<typeof resourceConflict>

export const makeReadingDictionaryPorts = (
  transport: Transport
): ReadingDictionaryPorts => {
  const dictionaryRpc = (headers: Headers, payload: unknown) =>
    transport.ownerRpc(
      headers,
      subjects.production.readingDictionary,
      "episode-production",
      payload,
      parseReadingDictionaryReply
    )

  return {
    listReadingDictionary: (headers) =>
      dictionaryRpc(headers, { operation: "List" }).pipe(
        Effect.flatMap(
          (reply): Effect.Effect<DictionaryPage, UnavailableProblem> =>
            reply._tag === "Entries"
              ? parse(ReadingDictionaryPageSchema)({
                  items: reply.entries,
                  page: { hasMore: false },
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    createReadingDictionary: ({ headers, payload }) =>
      dictionaryRpc(headers, { operation: "Create", ...payload }).pipe(
        Effect.flatMap(
          (
            reply: DictionaryReply
          ): Effect.Effect<
            DictionaryEntry,
            ConflictProblem | UnavailableProblem
          > =>
            reply._tag === "Entry"
              ? parse(ReadingDictionaryEntrySchema)(reply.entry).pipe(
                  Effect.mapError(unavailable)
                )
              : reply._tag === "Conflict"
                ? Effect.fail(resourceConflict())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    updateReadingDictionary: ({ headers, id, payload }) =>
      dictionaryRpc(headers, {
        operation: "Update",
        id,
        patch: payload,
      }).pipe(
        Effect.flatMap(
          (
            reply: DictionaryReply
          ): Effect.Effect<
            DictionaryEntry,
            NotFoundProblem | ConflictProblem | UnavailableProblem
          > =>
            reply._tag === "Entry"
              ? parse(ReadingDictionaryEntrySchema)(reply.entry).pipe(
                  Effect.mapError(unavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(resourceNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(resourceConflict())
                  : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    deleteReadingDictionary: ({ headers, id }) =>
      dictionaryRpc(headers, { operation: "Delete", id }).pipe(
        Effect.flatMap(
          (
            reply: DictionaryReply
          ): Effect.Effect<void, NotFoundProblem | UnavailableProblem> =>
            reply._tag === "Deleted"
              ? Effect.void
              : reply._tag === "NotFound"
                ? Effect.fail(resourceNotFound())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
