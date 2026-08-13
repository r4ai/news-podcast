import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { CompletionRelayResult } from "../application/completion-outbox.js"
import type { PipelineFailure } from "../application/execution-ports.js"

export type CompletionRelayEvent = Readonly<
  | {
      _tag: "CompletionRelaySucceeded"
      published: number
      duplicates: number
      nextDelayMillis: number
    }
  | {
      _tag: "CompletionRelayFailed"
      code: string
      consecutiveFailures: number
      nextDelayMillis: number
    }
>

export type CompletionRelayLoopPorts = Readonly<{
  relay: () => Effect.Effect<CompletionRelayResult, PipelineFailure>
  wait: (delayMillis: number) => Effect.Effect<void>
  observe: (event: CompletionRelayEvent) => Effect.Effect<void>
}>

export const runCompletionRelayLoop = (
  ports: CompletionRelayLoopPorts,
  config: {
    intervalMillis: number
    initialBackoffMillis: number
    maximumBackoffMillis: number
  }
): Effect.Effect<void> => {
  const loop = (failures: number, backoff: number): Effect.Effect<void> =>
    ports.relay().pipe(
      Effect.matchEffect({
        onFailure: (failure) => {
          const consecutiveFailures = failures + 1
          const event = deepFreeze({
            _tag: "CompletionRelayFailed" as const,
            code: failure.code,
            consecutiveFailures,
            nextDelayMillis: backoff,
          })
          return ports
            .observe(event)
            .pipe(
              Effect.andThen(ports.wait(backoff)),
              Effect.andThen(
                Effect.suspend(() =>
                  loop(
                    consecutiveFailures,
                    Math.min(backoff * 2, config.maximumBackoffMillis)
                  )
                )
              )
            )
        },
        onSuccess: (result) => {
          const event = deepFreeze({
            _tag: "CompletionRelaySucceeded" as const,
            ...result,
            nextDelayMillis: config.intervalMillis,
          })
          return ports
            .observe(event)
            .pipe(
              Effect.andThen(ports.wait(config.intervalMillis)),
              Effect.andThen(
                Effect.suspend(() => loop(0, config.initialBackoffMillis))
              )
            )
        },
      })
    )
  return loop(0, config.initialBackoffMillis)
}
