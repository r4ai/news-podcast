import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Option, Schema } from "effect"

import type {
  InterestProfileRepository,
  InterestProfileStoreError,
} from "../application/interest-profile.js"
import { InterestProfileSchema } from "../domain/interest-profile.js"
import type { SqlitePort } from "./sqlite-port.js"

const schema = `
CREATE TABLE IF NOT EXISTS content_interest_profiles (
  owner_id TEXT PRIMARY KEY,
  include_topics TEXT NOT NULL,
  exclude_topics TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`
const RowSchema = Schema.Struct({
  include: Schema.String,
  exclude: Schema.String,
})
const failure = (
  operation: InterestProfileStoreError["operation"],
  reason: InterestProfileStoreError["reason"] = "Unavailable"
): InterestProfileStoreError =>
  deepFreeze({ _tag: "InterestProfileStoreFailed", operation, reason })

export const createSqliteInterestProfileRepository = (
  database: SqlitePort,
  now: () => string
): Effect.Effect<InterestProfileRepository, InterestProfileStoreError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Save"),
  }).pipe(
    Effect.map(() => {
      const find: InterestProfileRepository["find"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.get(
              `SELECT include_topics AS include, exclude_topics AS exclude
                 FROM content_interest_profiles WHERE owner_id = ?`,
              [ownerId]
            ),
          catch: () => failure("Find"),
        }).pipe(
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.succeed(Option.none())
              : parse(RowSchema)(row).pipe(
                  Effect.flatMap((value) =>
                    parse(InterestProfileSchema)(value)
                  ),
                  Effect.map(Option.some),
                  Effect.mapError(() => failure("Find", "CorruptRecord"))
                )
          )
        )

      const save: InterestProfileRepository["save"] = (ownerId, profile) =>
        Effect.try({
          try: () => {
            database.run(
              `INSERT INTO content_interest_profiles
                (owner_id, include_topics, exclude_topics, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_id) DO UPDATE SET
                 include_topics = excluded.include_topics,
                 exclude_topics = excluded.exclude_topics,
                 updated_at = excluded.updated_at`,
              [ownerId, profile.include, profile.exclude, now()]
            )
            return deepFreeze(profile)
          },
          catch: () => failure("Save"),
        })

      return deepFreeze({ find, save })
    })
  )
