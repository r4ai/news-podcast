import type { Effect, Schema } from "effect"

import {
  AddFeedSubscriptionRequestSchema,
  AudioAccessSchema,
  BadRequestProblemSchema,
  ConflictProblemSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  EpisodePageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  HealthResponseSchema,
  JobReceiptSchema,
  NotFoundProblemSchema,
  SessionHeadersSchema,
  SessionResponseSchema,
  SubscriptionIdSchema,
  UnauthorizedProblemSchema,
  UnavailableProblemSchema,
  UnprocessableProblemSchema,
} from "./contract.js"

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>

export type GatewayPorts = Readonly<{
  health: () => Effect.Effect<TypeOf<typeof HealthResponseSchema>>
  resolveSession: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof SessionResponseSchema>,
    TypeOf<typeof UnavailableProblemSchema>
  >
  createEpisodeJob: (input: {
    readonly headers: TypeOf<typeof CreateEpisodeJobHeadersSchema>
    readonly payload: TypeOf<typeof CreateEpisodeJobRequestSchema>
  }) => Effect.Effect<
    TypeOf<typeof JobReceiptSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnprocessableProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listEpisodes: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof EpisodePageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  createAudioAccess: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly episodeId: TypeOf<typeof EpisodeIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof AudioAccessSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  addFeedSubscription: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly payload: TypeOf<typeof AddFeedSubscriptionRequestSchema>
  }) => Effect.Effect<
    TypeOf<typeof FeedSubscriptionSchema>,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnprocessableProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listFeedSubscriptions: (
    headers: TypeOf<typeof SessionHeadersSchema>
  ) => Effect.Effect<
    TypeOf<typeof FeedSubscriptionPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  deleteFeedSubscription: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly subscriptionId: TypeOf<typeof SubscriptionIdSchema>
  }) => Effect.Effect<
    void,
    | TypeOf<typeof BadRequestProblemSchema>
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
}>
