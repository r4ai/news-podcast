import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { parseCompletedEpisode } from "../adapters/parse-stored-episode.js"
import type { EpisodeCompletionPorts } from "../application/completion-ports.js"
import type { EpisodeCompletionNotice } from "../domain/episode-completion.js"
import { InboxMessageIdSchema } from "../domain/episode-completion.js"
import { handleNatsEpisodeCompleted } from "./nats-episode-completed.js"

const validMessage = {
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "episode-production",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: { _tag: "Service", service: "episode-production" },
  payload: {
    episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
    audioObjectKey: "episodes/user/episode.wav",
    title: "Daily news",
    sources: [{ url: "https://example.com/news/1", title: "News 1" }],
  },
}

const data = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

const makePorts = (
  events: string[],
  result: "Stored" | "Duplicate" = "Stored"
): EpisodeCompletionPorts => ({
  materialize: (notice: EpisodeCompletionNotice) =>
    parseCompletedEpisode({
      id: notice.episodeId,
      ownerId: notice.ownerId,
      title: notice.title,
      script: "Full script",
      audioObjectKey: notice.audioObjectKey,
      audioByteLength: 42,
      audioContentType: "audio/wav",
      createdAt: notice.occurredAt,
      sources: notice.sources.map((source) => ({
        sourceKind: "web",
        url: source.url,
        title: source.title,
      })),
    }).pipe(
      Effect.mapError(() => ({ _tag: "CompletionMaterializationFailure" }))
    ),
  saveOnce: () =>
    Effect.sync(() => {
      events.push("commit")
      return result
    }),
})

describe("NATS EpisodeCompleted runtime", () => {
  it.each(["Stored", "Duplicate"] as const)(
    "acks %s only after the transaction completes",
    async (result) => {
      const events: string[] = []
      const ack = vi.fn(() => events.push("ack"))
      const nack = vi.fn(() => events.push("nack"))

      await Effect.runPromise(
        handleNatsEpisodeCompleted(makePorts(events, result))({
          data: data(validMessage),
          ack: Effect.sync(ack).pipe(Effect.asVoid),
          nack: Effect.sync(nack).pipe(Effect.asVoid),
        })
      )

      expect(events).toEqual(["commit", "ack"])
      expect(ack).toHaveBeenCalledOnce()
      expect(nack).not.toHaveBeenCalled()
    }
  )

  it("nacks a persistence failure so NATS can redeliver", async () => {
    const events: string[] = []
    const ports = makePorts(events)
    ports.saveOnce = () =>
      Effect.fail({ _tag: "CompletionStoreFailure", operation: "save" })
    const ack = vi.fn()
    const nack = vi.fn()

    const exit = await Effect.runPromiseExit(
      handleNatsEpisodeCompleted(ports)({
        data: data(validMessage),
        ack: Effect.sync(ack).pipe(Effect.asVoid),
        nack: Effect.sync(nack).pipe(Effect.asVoid),
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(nack).toHaveBeenCalledOnce()
    expect(ack).not.toHaveBeenCalled()
  })

  it("nacks invalid JSON or protocol data without materializing it", async () => {
    const materialize = vi.fn()
    const ports: EpisodeCompletionPorts = {
      materialize,
      saveOnce: () => Effect.succeed("Stored"),
    }
    const nack = vi.fn()

    const exit = await Effect.runPromiseExit(
      handleNatsEpisodeCompleted(ports)({
        data: new TextEncoder().encode("not-json"),
        ack: Effect.void,
        nack: Effect.sync(nack).pipe(Effect.asVoid),
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(nack).toHaveBeenCalledOnce()
    expect(materialize).not.toHaveBeenCalled()
  })

  it("uses the parsed message ID as the inbox dedupe key", async () => {
    const saveOnce = vi.fn(() => Effect.succeed("Stored" as const))
    const ports = makePorts([])
    ports.saveOnce = saveOnce

    await Effect.runPromise(
      handleNatsEpisodeCompleted(ports)({
        data: data(validMessage),
        ack: Effect.void,
        nack: Effect.void,
      })
    )

    expect(saveOnce).toHaveBeenCalledWith(
      Effect.runSync(parse(InboxMessageIdSchema)(validMessage.messageId)),
      expect.objectContaining({ id: validMessage.payload.episodeId }),
      validMessage.occurredAt
    )
  })
})
