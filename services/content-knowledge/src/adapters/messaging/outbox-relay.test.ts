import { deepFreeze } from "@news-podcast/kernel"
import {
  ActorSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  ArticleArchivedSchema,
  CapturedAtSchema,
} from "../../domain/article.js"
import {
  ArticleArchivedWireEnvelopeSchema,
  OutboxBatchSizeSchema,
  type OutboxPublisher,
  type OutboxStore,
  type PendingOutboxMessage,
} from "./outbox.js"
import { relayOutbox } from "./outbox-relay.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => deepFreeze(Schema.decodeUnknownSync(schema)(input))

const messageId = decode(
  MessageIdSchema,
  "8fb12955-2175-4675-be63-e42227d5ed19"
)
const publishedAt = decode(CapturedAtSchema, "2026-08-12T00:01:00.000Z")
const message: PendingOutboxMessage = deepFreeze({
  messageId,
  subject: "content.article-archived.v1",
  envelope: decode(ArticleArchivedWireEnvelopeSchema, {
    messageId,
    correlationId: decode(
      CorrelationIdSchema,
      "ea122752-73d0-4851-9664-7d3e63e76859"
    ),
    causationId: decode(
      MessageIdSchema,
      "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4"
    ),
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "content-knowledge",
    traceparent: decode(
      TraceparentSchema,
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    ),
    actor: decode(ActorSchema, { _tag: "Anonymous" }),
    payload: decode(ArticleArchivedSchema, {
      _tag: "ArticleArchived",
      archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
      articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4",
      sourceUrl: "https://news.example.com/posts/1",
      title: "Typed domain models",
      archivedAt: "2026-08-12T00:00:00.000Z",
      markdown: {
        _tag: "Markdown",
        key: "articles/snapshot/markdown/article.md",
        sha256: "3".repeat(64),
        mediaType: "text/markdown",
        byteLength: 80,
      },
    }),
  }),
  payload: "serialized-envelope",
})
const batchSize = decode(OutboxBatchSizeSchema, 10)

const makeStore = (): OutboxStore => ({
  listPending: vi.fn(() => Effect.succeed(deepFreeze([message]))),
  markPublished: vi.fn(() => Effect.succeed(undefined)),
})
const makePublisher = (): OutboxPublisher => ({
  publish: vi.fn(() =>
    Effect.succeed(
      deepFreeze({
        stream: "CONTENT_EVENTS",
        sequence: 42,
        duplicate: false,
      })
    )
  ),
})

describe("outbox relay", () => {
  it("marks a row only after JetStream acknowledges its publication", async () => {
    const store = makeStore()
    const publisher = makePublisher()

    const result = await Effect.runPromise(
      relayOutbox({ store, publisher, now: () => publishedAt })(batchSize)
    )

    expect(publisher.publish).toHaveBeenCalledWith(message)
    expect(store.markPublished).toHaveBeenCalledWith(messageId, publishedAt)
    expect(result).toEqual({ published: 1, duplicates: 0 })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("leaves a row pending when publish fails", async () => {
    const store = makeStore()
    const publisher = makePublisher()
    vi.mocked(publisher.publish).mockReturnValue(
      Effect.fail(
        deepFreeze({ _tag: "OutboxPublishFailed", reason: "Unavailable" })
      )
    )

    const exit = await Effect.runPromiseExit(
      relayOutbox({ store, publisher, now: () => publishedAt })(batchSize)
    )

    expect(exit._tag).toBe("Failure")
    expect(store.markPublished).not.toHaveBeenCalled()
  })

  it("re-publishes the same message id when marking failed after an ack", async () => {
    const store = makeStore()
    const publisher = makePublisher()
    vi.mocked(store.markPublished)
      .mockReturnValueOnce(
        Effect.fail(
          deepFreeze({
            _tag: "OutboxStoreFailed",
            operation: "MarkPublished",
            reason: "Unavailable",
          })
        )
      )
      .mockReturnValueOnce(Effect.succeed(undefined))

    const first = await Effect.runPromiseExit(
      relayOutbox({ store, publisher, now: () => publishedAt })(batchSize)
    )
    const second = await Effect.runPromise(
      relayOutbox({ store, publisher, now: () => publishedAt })(batchSize)
    )

    expect(first._tag).toBe("Failure")
    expect(second.published).toBe(1)
    expect(publisher.publish).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publisher.publish).mock.calls[0]?.[0].messageId).toBe(
      vi.mocked(publisher.publish).mock.calls[1]?.[0].messageId
    )
  })
})
