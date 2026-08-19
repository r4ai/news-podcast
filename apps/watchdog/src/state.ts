import { decodePersistedJsonSync } from "@news-podcast/persistence"
import { Schema } from "effect"

import type { WatchdogState } from "./watchdog.js"

const UtcInstantStringSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
const TargetStateSchema = Schema.Struct({
  up: Schema.Boolean,
  consecutiveFailures: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastSuccessAt: Schema.optionalKey(UtcInstantStringSchema),
})
const WatchdogStateSchema = Schema.Struct({
  failures: Schema.Record(Schema.String, Schema.String),
  targets: Schema.optionalKey(Schema.Record(Schema.String, TargetStateSchema)),
  lastNotificationAt: Schema.optionalKey(UtcInstantStringSchema),
  telemetryValue: Schema.optionalKey(Schema.Number),
  telemetryChangedAt: Schema.optionalKey(UtcInstantStringSchema),
})

export const decodeWatchdogState = (input: string): WatchdogState =>
  decodePersistedJsonSync("watchdog.state", WatchdogStateSchema, input)
