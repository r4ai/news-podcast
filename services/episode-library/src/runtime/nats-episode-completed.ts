import { Effect } from "effect"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import { parseMessageEnvelope, subjects } from "@news-podcast/protocols"

import { parseEpisodeCompletedMessage } from "../adapters/parse-episode-completed-message.js"
import {
  consumeEpisodeCompleted,
  type EpisodeCompletionPorts,
} from "../application/index.js"
import type { CompletionStoreFailure } from "../application/ports/completion.js"

export type NatsPayloadDecodeFailure = Readonly<{
  _tag: "NatsPayloadDecodeFailure"
}>

export interface NatsEpisodeCompletedDelivery<AckError, NackError> {
  readonly data: Uint8Array
  /** One-based JetStream delivery count used to bound redelivery delay. */
  readonly deliveryCount: number
  /** Acknowledges only after the inbox/episode transaction has committed. */
  readonly ack: Effect.Effect<void, AckError>
  /** Leaves the message eligible for redelivery. */
  readonly nack: (delayMillis: number) => Effect.Effect<void, NackError>
}

export type EpisodeCompletedNackBackoff = Readonly<{
  readonly initialDelayMillis: number
  readonly maximumDelayMillis: number
}>

const defaultNackBackoff: EpisodeCompletedNackBackoff = Object.freeze({
  initialDelayMillis: 1_000,
  maximumDelayMillis: 30_000,
})

export const episodeCompletedNackDelay = (
  deliveryCount: number,
  backoff: EpisodeCompletedNackBackoff = defaultNackBackoff
): number =>
  Math.min(
    backoff.initialDelayMillis * 2 ** Math.max(0, deliveryCount - 1),
    backoff.maximumDelayMillis
  )

const decodeJson = (data: Uint8Array) =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(data)),
    catch: (): NatsPayloadDecodeFailure => ({
      _tag: "NatsPayloadDecodeFailure",
    }),
  })

const isTransientPersistenceFailure = (
  failure: unknown
): failure is CompletionStoreFailure =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "CompletionStoreFailure"

export type EpisodeCompletedHandlingResult = "Committed" | "Discarded"

export const handleNatsEpisodeCompleted = (
  ports: EpisodeCompletionPorts,
  nackBackoff: EpisodeCompletedNackBackoff = defaultNackBackoff
) =>
  Effect.fn("episodeLibrary.nats.episodeCompleted")(function* <
    AckError,
    NackError,
  >(delivery: NatsEpisodeCompletedDelivery<AckError, NackError>) {
    const consume = decodeJson(delivery.data).pipe(
      Effect.flatMap((input) =>
        parseMessageEnvelope(input).pipe(
          Effect.flatMap((envelope) =>
            withRemoteTraceparent(
              withMessagingSpan(
                parseEpisodeCompletedMessage(input).pipe(
                  Effect.flatMap(consumeEpisodeCompleted(ports)),
                  Effect.tap(() =>
                    Effect.logInfo("episode completion committed", {
                      message_id: envelope.messageId,
                      correlation_id: envelope.correlationId,
                    })
                  )
                ),
                subjects.production.jobCompletedV2,
                "process"
              ),
              envelope.traceparent
            )
          )
        )
      )
    )
    type ConsumeFailure = Effect.Error<typeof consume>

    const result = yield* consume.pipe(
      Effect.as("Consumed" as const),
      Effect.catch(
        (
          failure: ConsumeFailure
        ): Effect.Effect<
          "Discarded",
          ConsumeFailure | AckError | NackError
        > => {
          if (isTransientPersistenceFailure(failure)) {
            return delivery
              .nack(
                episodeCompletedNackDelay(delivery.deliveryCount, nackBackoff)
              )
              .pipe(Effect.andThen(Effect.fail(failure)))
          }
          return delivery.ack.pipe(Effect.as("Discarded" as const))
        }
      )
    )
    if (result === "Discarded") return result

    yield* delivery.ack
    return "Committed" as const
  })
