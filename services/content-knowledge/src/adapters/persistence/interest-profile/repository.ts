import { deepFreeze, parse } from "@news-podcast/kernel"
import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"

import { contentInterestProfiles } from "../../../../drizzle/schema.js"
import type {
  InterestProfileRepository,
  InterestProfileStoreError,
} from "../../../application/interest-profile.js"
import { InterestProfileSchema } from "../../../domain/interest-profile.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

const RowSchema = Schema.Struct({
  include: Schema.String,
  exclude: Schema.String,
})

const failure = (
  operation: InterestProfileStoreError["operation"],
  reason: InterestProfileStoreError["reason"] = "Unavailable"
): InterestProfileStoreError =>
  deepFreeze({ _tag: "InterestProfileStoreFailed", operation, reason })

export const createInterestProfileRepository = (
  database: ContentKnowledgeDatabase,
  now: () => string
): Effect.Effect<InterestProfileRepository, InterestProfileStoreError> =>
  Effect.sync(() => {
    const find: InterestProfileRepository["find"] = (ownerId) =>
      Effect.try({
        try: () =>
          database
            .select({
              include: contentInterestProfiles.includeTopics,
              exclude: contentInterestProfiles.excludeTopics,
            })
            .from(contentInterestProfiles)
            .where(eq(contentInterestProfiles.ownerId, ownerId))
            .get(),
        catch: () => failure("Find"),
      }).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.succeed(Option.none())
            : parse(RowSchema)(row).pipe(
                Effect.flatMap((value) => parse(InterestProfileSchema)(value)),
                Effect.map(Option.some),
                Effect.mapError(() => failure("Find", "CorruptRecord"))
              )
        )
      )

    const save: InterestProfileRepository["save"] = (ownerId, profile) =>
      Effect.try({
        try: () => {
          const updatedAt = now()
          database
            .insert(contentInterestProfiles)
            .values({
              ownerId,
              includeTopics: profile.include,
              excludeTopics: profile.exclude,
              updatedAt,
            })
            .onConflictDoUpdate({
              target: contentInterestProfiles.ownerId,
              set: {
                includeTopics: profile.include,
                excludeTopics: profile.exclude,
                updatedAt,
              },
            })
            .run()
          return deepFreeze(profile)
        },
        catch: () => failure("Save"),
      })

    return deepFreeze({ find, save })
  })
