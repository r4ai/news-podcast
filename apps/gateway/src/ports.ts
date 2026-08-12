import type { Effect, Schema } from "effect"

import {
  AddFeedSubscriptionRequestSchema,
  AudioAccessSchema,
  BadRequestProblemSchema,
  ConflictProblemSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  EpisodeSchema,
  EpisodeJobSchema,
  EpisodeJobPageSchema,
  EpisodePageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  HealthResponseSchema,
  JobReceiptSchema,
  JobIdSchema,
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
  listEpisodeJobs: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly limit?: number
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobPageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  cancelEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeJobSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  retryEpisodeJob: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
    readonly idempotencyKey: string
  }) => Effect.Effect<
    TypeOf<typeof JobReceiptSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof ConflictProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  replayEpisodeJobEvents: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly jobId: TypeOf<typeof JobIdSchema>
    readonly afterSequence: number
  }) => Effect.Effect<
    Readonly<{
      snapshot: TypeOf<typeof EpisodeJobSchema>
      events: readonly Readonly<{
        sequence: number
        job: TypeOf<typeof EpisodeJobSchema>
      }>[]
    }>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  listEpisodes: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly cursor?: string
  }) => Effect.Effect<
    TypeOf<typeof EpisodePageSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof UnavailableProblemSchema>
  >
  getEpisode: (input: {
    readonly headers: TypeOf<typeof SessionHeadersSchema>
    readonly episodeId: TypeOf<typeof EpisodeIdSchema>
  }) => Effect.Effect<
    TypeOf<typeof EpisodeSchema>,
    | TypeOf<typeof UnauthorizedProblemSchema>
    | TypeOf<typeof NotFoundProblemSchema>
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
