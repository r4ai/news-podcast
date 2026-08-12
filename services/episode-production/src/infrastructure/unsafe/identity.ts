import { randomUUID } from "node:crypto"
import { DateTime } from "effect"

import type {
  EpisodeId,
  JobId,
  LeaseTokenSchema,
  UtcTimestamp,
} from "../../domain/episode-job.js"
import type { Schema } from "effect"

/** Platform guarantees are asserted only at the unsafe edge. */
export const randomJobIdUnsafe = (): JobId => randomUUID() as JobId
export const randomEpisodeIdUnsafe = (): EpisodeId => randomUUID() as EpisodeId
export const randomLeaseTokenUnsafe = (): Schema.Schema.Type<
  typeof LeaseTokenSchema
> => randomUUID() as Schema.Schema.Type<typeof LeaseTokenSchema>

export const currentUtcTimestampUnsafe = (): UtcTimestamp =>
  DateTime.nowUnsafe()
