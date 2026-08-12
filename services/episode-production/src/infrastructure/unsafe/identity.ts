import { randomUUID } from "node:crypto"
import { DateTime } from "effect"

import type { JobId, UtcTimestamp } from "../../domain/episode-job.js"

/** Platform guarantees are asserted only at the unsafe edge. */
export const randomJobIdUnsafe = (): JobId => randomUUID() as JobId

export const currentUtcTimestampUnsafe = (): UtcTimestamp =>
  DateTime.nowUnsafe()
