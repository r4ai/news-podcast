import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import { databaseError, type DatabaseError } from "./errors.js"

const strictDecodeOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const

const corruptRecord = (operation: string): DatabaseError =>
  databaseError(operation, "CorruptRecord")

/**
 * Decodes persisted JSON at the storage boundary.
 * Failure values deliberately omit the input and schema diagnostics.
 */
export const decodePersistedJson = <
  S extends Schema.ConstraintDecoder<unknown>,
>(
  operation: string,
  schema: S,
  input: string
): Effect.Effect<Schema.Schema.Type<S>, DatabaseError> =>
  Effect.try({
    try: (): unknown => JSON.parse(input),
    catch: () => corruptRecord(operation),
  }).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(schema, strictDecodeOptions)(json)
    ),
    Effect.map((decoded) => deepFreeze(decoded) as Schema.Schema.Type<S>),
    Effect.mapError(() => corruptRecord(operation))
  )

/** Synchronous variant for transaction callbacks that cannot yield an Effect. */
export const decodePersistedJsonSync = <
  S extends Schema.ConstraintDecoder<unknown>,
>(
  operation: string,
  schema: S,
  input: string
): Schema.Schema.Type<S> => {
  try {
    return deepFreeze(
      Schema.decodeUnknownSync(schema, strictDecodeOptions)(JSON.parse(input))
    ) as Schema.Schema.Type<S>
  } catch {
    throw corruptRecord(operation)
  }
}
