import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  OutboxBatchSize,
  OutboxPublisher,
  OutboxPublisherError,
  OutboxStore,
  OutboxStoreError,
} from "./outbox.js"
import type { CapturedAt } from "../../domain/article.js"

export type RelayResult = DeepReadonly<{
  readonly published: number
  readonly duplicates: number
}>

export const relayOutbox =
  (dependencies: {
    readonly store: OutboxStore
    readonly publisher: OutboxPublisher
    readonly now: () => CapturedAt
  }) =>
  (
    batchSize: OutboxBatchSize
  ): Effect.Effect<RelayResult, OutboxStoreError | OutboxPublisherError> =>
    dependencies.store.listPending(batchSize).pipe(
      Effect.flatMap((messages) =>
        Effect.forEach(messages, (message) =>
          dependencies.publisher
            .publish(message)
            .pipe(
              Effect.flatMap((acknowledgement) =>
                dependencies.store
                  .markPublished(message.messageId, dependencies.now())
                  .pipe(Effect.as(acknowledgement))
              )
            )
        )
      ),
      Effect.map((acknowledgements) =>
        deepFreeze({
          published: acknowledgements.length,
          duplicates: acknowledgements.filter(
            (acknowledgement) => acknowledgement.duplicate
          ).length,
        })
      )
    )
