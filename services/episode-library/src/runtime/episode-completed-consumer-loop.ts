import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { EpisodeCompletionPorts } from "../application/ports/completion.js"
import type { UnsafeEpisodeCompletedConsumer } from "../infrastructure/unsafe/nats-episode-completed-consumer.js"
import { handleNatsEpisodeCompleted } from "./nats-episode-completed.js"

export type EpisodeCompletedConsumerFailure = DeepReadonly<{
  readonly _tag: "EpisodeCompletedConsumerIoFailure"
  readonly operation: "Ack" | "Nack" | "Receive"
}>

export type EpisodeCompletedConsumerOutcome = DeepReadonly<
  | {
      readonly _tag: "EpisodeCompletedAcknowledged"
      readonly deliveryCount: number
    }
  | {
      readonly _tag: "EpisodeCompletedNacked"
      readonly deliveryCount: number
      readonly delayMillis: number
    }
>

export type EpisodeCompletedConsumerLoopConfig = DeepReadonly<{
  readonly initialNackDelayMillis: number
  readonly maximumNackDelayMillis: number
  readonly observe?: (
    outcome: EpisodeCompletedConsumerOutcome
  ) => Effect.Effect<void>
}>

const ioFailure = (
  operation: EpisodeCompletedConsumerFailure["operation"]
): EpisodeCompletedConsumerFailure =>
  deepFreeze({ _tag: "EpisodeCompletedConsumerIoFailure", operation })

const logOutcome = (outcome: EpisodeCompletedConsumerOutcome) =>
  outcome._tag === "EpisodeCompletedAcknowledged"
    ? Effect.logInfo("episode completion acknowledged", {
        event_name: "episode_library.completion.acknowledged",
        delivery_count: outcome.deliveryCount,
      })
    : Effect.logWarning("episode completion nacked", {
        event_name: "episode_library.completion.nacked",
        delivery_count: outcome.deliveryCount,
        retry_delay_ms: outcome.delayMillis,
      })

/** Sequential pull processing preserves SQLite transaction ordering and backpressure. */
export const runEpisodeCompletedConsumerLoop = (
  consumer: UnsafeEpisodeCompletedConsumer,
  ports: EpisodeCompletionPorts,
  config: EpisodeCompletedConsumerLoopConfig
): Effect.Effect<void, EpisodeCompletedConsumerFailure> => {
  const observe = config.observe ?? (() => Effect.void)
  const loop = (): Effect.Effect<void, EpisodeCompletedConsumerFailure> =>
    Effect.tryPromise({
      try: () => consumer.receive(),
      catch: () => ioFailure("Receive"),
    }).pipe(
      Effect.flatMap((delivery) => {
        if (delivery === undefined) return Effect.void
        let nackDelayMillis: number | undefined
        return handleNatsEpisodeCompleted(ports, {
          initialDelayMillis: config.initialNackDelayMillis,
          maximumDelayMillis: config.maximumNackDelayMillis,
        })({
          data: delivery.data,
          deliveryCount: delivery.deliveryCount,
          ack: Effect.tryPromise({
            try: () => delivery.ack(),
            catch: () => ioFailure("Ack"),
          }),
          nack: (delayMillis) => {
            nackDelayMillis = delayMillis
            return Effect.tryPromise({
              try: () => delivery.nack(delayMillis),
              catch: () => ioFailure("Nack"),
            })
          },
        }).pipe(
          Effect.matchEffect({
            onFailure: (failure) => {
              if (failure._tag === "EpisodeCompletedConsumerIoFailure") {
                return Effect.fail(failure)
              }
              const outcome = deepFreeze({
                _tag: "EpisodeCompletedNacked" as const,
                deliveryCount: delivery.deliveryCount,
                delayMillis: nackDelayMillis ?? config.maximumNackDelayMillis,
              })
              return logOutcome(outcome).pipe(
                Effect.andThen(observe(outcome)),
                Effect.andThen(loop())
              )
            },
            onSuccess: () => {
              const outcome = deepFreeze({
                _tag: "EpisodeCompletedAcknowledged" as const,
                deliveryCount: delivery.deliveryCount,
              })
              return logOutcome(outcome).pipe(
                Effect.andThen(observe(outcome)),
                Effect.andThen(loop())
              )
            },
          })
        )
      })
    )

  return loop()
}
