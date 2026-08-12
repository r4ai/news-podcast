import type { Effect, Schema } from "effect"

import {
  AudioAccessSchema,
  BadRequestProblemSchema,
  ConflictProblemSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  EpisodePageSchema,
  HealthResponseSchema,
  JobReceiptSchema,
  NotFoundProblemSchema,
  SessionHeadersSchema,
  SessionResponseSchema,
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
}>
