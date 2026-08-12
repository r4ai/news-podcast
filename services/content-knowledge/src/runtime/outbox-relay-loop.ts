import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  OutboxPublisherError,
  OutboxStoreError,
  RelayResult,
} from "../adapters/index.js"

export type OutboxRelayLoopConfig = DeepReadonly<{
  readonly batchSize: number
  readonly intervalMillis: number
  readonly initialBackoffMillis: number
  readonly maximumBackoffMillis: number
}>

export type OutboxRelayCycleOutcome = DeepReadonly<
  | {
      readonly _tag: "OutboxRelayCycleSucceeded"
      readonly published: number
      readonly duplicates: number
      readonly consecutiveFailures: 0
      readonly nextDelayMillis: number
    }
  | {
      readonly _tag: "OutboxRelayCycleFailed"
      readonly reason:
        | "CorruptRecord"
        | "PublisherUnavailable"
        | "RuntimeUnavailable"
        | "StoreUnavailable"
      readonly consecutiveFailures: number
      readonly nextDelayMillis: number
    }
>

export type OutboxRelayLoopRuntime = Readonly<{
  readonly wait: (delayMillis: number) => Effect.Effect<void>
  readonly observe: (outcome: OutboxRelayCycleOutcome) => Effect.Effect<void>
}>

const liveRuntime: OutboxRelayLoopRuntime = Object.freeze({
  wait: (delayMillis) => Effect.sleep(delayMillis),
  observe: () => Effect.void,
})

const failureReason = (
  failure: OutboxPublisherError | OutboxStoreError
): Extract<
  OutboxRelayCycleOutcome,
  { _tag: "OutboxRelayCycleFailed" }
>["reason"] => {
  if (failure._tag === "OutboxPublishFailed") return "PublisherUnavailable"
  return failure.reason === "CorruptRecord"
    ? "CorruptRecord"
    : "StoreUnavailable"
}

const isOutboxFailure = (
  failure: OutboxPublisherError | OutboxStoreError | { readonly _tag: string }
): failure is OutboxPublisherError | OutboxStoreError =>
  failure._tag === "OutboxPublishFailed" || failure._tag === "OutboxStoreFailed"

const logOutcome = (outcome: OutboxRelayCycleOutcome) =>
  outcome._tag === "OutboxRelayCycleSucceeded"
    ? Effect.logInfo("content outbox relay cycle succeeded", {
        event_name: "content.outbox.relay",
        published: outcome.published,
        duplicates: outcome.duplicates,
        next_delay_ms: outcome.nextDelayMillis,
      })
    : Effect.logWarning("content outbox relay cycle failed", {
        event_name: "content.outbox.relay",
        reason: outcome.reason,
        consecutive_failures: outcome.consecutiveFailures,
        next_delay_ms: outcome.nextDelayMillis,
      })

/** Runs one relay at a time; handled store/publisher failures only affect delay. */
export const runOutboxRelayLoop = (
  config: OutboxRelayLoopConfig,
  relayOnce: (
    batchSize: unknown
  ) => Effect.Effect<
    RelayResult,
    OutboxPublisherError | OutboxStoreError | { readonly _tag: string }
  >,
  runtime: Partial<OutboxRelayLoopRuntime> = liveRuntime
): Effect.Effect<void> => {
  const wait = runtime.wait ?? liveRuntime.wait
  const observe = runtime.observe ?? liveRuntime.observe

  const loop = (
    consecutiveFailures: number,
    backoffMillis: number
  ): Effect.Effect<void> =>
    Effect.suspend(() => relayOnce(config.batchSize)).pipe(
      Effect.matchEffect({
        onFailure: (failure) => {
          const failures = consecutiveFailures + 1
          const outcome = deepFreeze({
            _tag: "OutboxRelayCycleFailed" as const,
            reason: isOutboxFailure(failure)
              ? failureReason(failure)
              : "RuntimeUnavailable",
            consecutiveFailures: failures,
            nextDelayMillis: backoffMillis,
          })
          const nextBackoff = Math.min(
            backoffMillis * 2,
            config.maximumBackoffMillis
          )
          return logOutcome(outcome).pipe(
            Effect.andThen(observe(outcome)),
            Effect.andThen(wait(backoffMillis)),
            Effect.andThen(loop(failures, nextBackoff))
          )
        },
        onSuccess: (result) => {
          const outcome = deepFreeze({
            _tag: "OutboxRelayCycleSucceeded" as const,
            ...result,
            consecutiveFailures: 0 as const,
            nextDelayMillis: config.intervalMillis,
          })
          return logOutcome(outcome).pipe(
            Effect.andThen(observe(outcome)),
            Effect.andThen(wait(config.intervalMillis)),
            Effect.andThen(loop(0, config.initialBackoffMillis))
          )
        },
      })
    )

  return loop(0, config.initialBackoffMillis)
}
