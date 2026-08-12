import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Option } from "effect"

import {
  defaultInterestProfile,
  type InterestProfile,
} from "../domain/interest-profile.js"
import type { OwnerId } from "../domain/subscription.js"

export type InterestProfileStoreError = DeepReadonly<{
  readonly _tag: "InterestProfileStoreFailed"
  readonly operation: "Find" | "Save"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type InterestProfileRepository = DeepReadonly<{
  readonly find: (
    ownerId: OwnerId
  ) => Effect.Effect<Option.Option<InterestProfile>, InterestProfileStoreError>
  readonly save: (
    ownerId: OwnerId,
    profile: InterestProfile
  ) => Effect.Effect<InterestProfile, InterestProfileStoreError>
}>

export const createInterestProfileOperations = (
  repository: InterestProfileRepository
) =>
  deepFreeze({
    get: Effect.fn("contentKnowledge.interestProfile.get")(function* (
      ownerId: OwnerId
    ) {
      const found = yield* repository.find(ownerId)
      return Option.match(found, {
        onNone: () => defaultInterestProfile,
        onSome: deepFreeze,
      })
    }),
    update: Effect.fn("contentKnowledge.interestProfile.update")(function* (
      ownerId: OwnerId,
      profile: InterestProfile
    ) {
      return yield* repository.save(ownerId, profile)
    }),
  })
