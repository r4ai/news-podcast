import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parse } from "@news-podcast/kernel"
import {
  parseCreateAudioAccessReply,
  parseListEpisodesReply,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Fiber } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AudioAccessSigner } from "../application/ports.js"
import { InboxMessageIdSchema } from "../domain/episode-completion.js"
import { CompletedEpisodeSchema } from "../domain/episode.js"
import { makeSqliteEpisodeRepository } from "../infrastructure/index.js"
import type { UnsafeNatsRpcServer } from "../infrastructure/unsafe/nats-rpc.js"
import type { UnsafeEpisodeCompletedConsumer } from "../infrastructure/unsafe/nats-episode-completed-consumer.js"
import {
  parseNodeEpisodeLibraryRpcConfig,
  runNodeEpisodeLibraryService,
  runNodeEpisodeLibraryRpc,
} from "./node.js"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const ownerId = "better-auth-user_01"
const episodeId = "8a76daf6-d3d7-47db-9644-228dc5328c84"
const config = {
  sqlitePath: "unused.sqlite",
  natsServers: ["nats://127.0.0.1:4222"],
  queueGroup: "episode-library",
}
const serviceConfig = {
  ...config,
  completionConsumer: {
    stream: "EPISODE_PRODUCTION",
    durableName: "episode-library-completions",
    ackWaitMillis: 30_000,
    maximumDeliveries: 10,
    initialNackDelayMillis: 1_000,
    maximumNackDelayMillis: 30_000,
  },
}

const request = (subject: string, payload: unknown, messageId: string) => ({
  subject,
  payload: JSON.stringify({
    messageId,
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "gateway",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "User", userId: ownerId },
    payload,
  }),
})

const completionMessage = {
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "episode-production",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: { _tag: "Service", service: "episode-production" },
  payload: {
    episodeId,
    ownerId,
    title: "Daily news",
    script: "Full script",
    audio: {
      objectKey: `episodes/${episodeId}.wav`,
      byteLength: 42,
      contentType: "audio/wav",
    },
    sources: [
      {
        sourceKind: "rss",
        snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4",
        url: "https://example.com/news/1",
        title: "News 1",
      },
    ],
    completedAt: "2026-08-12T00:00:00.000Z",
  },
}

describe("episode-library Node RPC runtime", () => {
  it("materializes a completion before serving it from the same SQLite service scope", async () => {
    const directory = mkdtempSync(join(tmpdir(), "episode-library-service-"))
    directories.push(directory)
    const sqlitePath = join(directory, "library.sqlite")
    const events: string[] = []
    let resolveAcknowledged!: () => void
    const acknowledged = new Promise<void>((resolve) => {
      resolveAcknowledged = resolve
    })
    let completionDelivered = false
    const completionConsumer: UnsafeEpisodeCompletedConsumer = {
      receive: async () => {
        if (completionDelivered) return new Promise(() => undefined)
        completionDelivered = true
        return {
          data: new TextEncoder().encode(JSON.stringify(completionMessage)),
          deliveryCount: 1,
          ack: async () => {
            events.push("completion.ack")
            resolveAcknowledged()
          },
          nack: async (delayMillis) =>
            void events.push(`completion.nack:${delayMillis}`),
        }
      },
      drain: async () => void events.push("completion.drain"),
    }
    const replies: string[] = []
    let rpcDelivered = false
    const rpcServer: UnsafeNatsRpcServer = {
      receive: async () => {
        if (rpcDelivered) return undefined
        await acknowledged
        rpcDelivered = true
        return {
          ...request(
            subjects.library.listEpisodes,
            {},
            "10e2d4e1-c127-479f-a124-2ea037bd9319"
          ),
          reply: async (payload) => void replies.push(payload),
        }
      },
      drain: async () => void events.push("rpc.drain"),
    }

    await Effect.runPromise(
      runNodeEpisodeLibraryService(
        {
          ...serviceConfig,
          sqlitePath,
          s3: {
            endpoint: "http://seaweedfs:8333",
            region: "us-east-1",
            bucket: "private-audio",
            accessKeyId: "access-id",
            secretAccessKey: "secret-key",
          },
        },
        {
          openSigner: () => ({
            signer: { issue: vi.fn() },
            close: Effect.sync(() => void events.push("signer.close")),
          }),
          connectCompletionConsumer: async () => completionConsumer,
          rpcDependencies: {
            connectNats: async () => rpcServer,
            newMessageId: () => "b3ec6a98-bc73-4c94-a3bf-7e8cc8e5f02a",
            now: () => "2026-08-12T00:00:01.000Z",
            nowEpochMillis: () => Date.parse("2026-08-12T00:00:00.000Z"),
          },
        }
      )
    )

    const envelope = await Effect.runPromise(
      parseMessageEnvelope(JSON.parse(replies[0]!) as unknown)
    )
    const listed = await Effect.runPromise(
      parseListEpisodesReply(envelope.payload)
    )
    expect(listed).toMatchObject({
      _tag: "Listed",
      page: { items: [{ id: episodeId, title: "Daily news" }] },
    })
    expect(JSON.stringify(listed)).not.toContain(ownerId)
    expect(events).toEqual([
      "completion.ack",
      "completion.drain",
      "rpc.drain",
      "signer.close",
    ])
  })

  it("uses SQLite, handles both subjects sequentially, and drains NATS", async () => {
    const directory = mkdtempSync(join(tmpdir(), "episode-library-rpc-"))
    directories.push(directory)
    const sqlitePath = join(directory, "library.sqlite")
    const repository = makeSqliteEpisodeRepository(sqlitePath)
    const completed = Effect.runSync(
      parse(CompletedEpisodeSchema)({
        _tag: "CompletedEpisode",
        id: episodeId,
        ownerId,
        title: "Daily news",
        script: "Script",
        audio: {
          objectKey: `episodes/${episodeId}.wav`,
          byteLength: 42,
          contentType: "audio/wav",
        },
        sources: [
          {
            _tag: "WebSource",
            url: "https://example.com/news/1",
            title: "News 1",
          },
        ],
        createdAt: "2026-08-12T00:00:00.000Z",
      })
    )
    await Effect.runPromise(
      repository
        .saveOnce(
          Effect.runSync(
            parse(InboxMessageIdSchema)("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80")
          ),
          completed as never,
          "2026-08-12T00:00:00.000Z" as never
        )
        .pipe(Effect.ensuring(repository.close))
    )

    const replies: string[] = []
    const events: string[] = []
    let outstanding = false
    const pending = [
      request(
        subjects.library.listEpisodes,
        {},
        "10e2d4e1-c127-479f-a124-2ea037bd9319"
      ),
      request(
        subjects.library.createAudioAccess,
        { episodeId },
        "6518412b-ce2f-4641-9f2c-a02dd515bc31"
      ),
    ]
    const drain = vi.fn(async () => void events.push("drain"))
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        if (outstanding) throw new Error("received concurrently")
        const next = pending.shift()
        if (!next) return undefined
        outstanding = true
        events.push(`receive:${next.subject}`)
        return {
          ...next,
          reply: async (reply) => {
            replies.push(reply)
            outstanding = false
            events.push(`reply:${next.subject}`)
          },
        }
      },
      drain,
    }
    const connectNats = vi.fn(async () => server)
    const signer: AudioAccessSigner = {
      issue: vi.fn(() => Effect.succeed("https://audio.test/signed" as never)),
    }
    const replyIds = [
      "b3ec6a98-bc73-4c94-a3bf-7e8cc8e5f02a",
      "10c9628f-6bd9-4f87-93cb-7332e2038a55",
    ]

    await Effect.runPromise(
      runNodeEpisodeLibraryRpc({ ...config, sqlitePath }, signer, {
        connectNats,
        newMessageId: () => replyIds.shift()!,
        now: () => "2026-08-12T00:00:01.000Z",
        nowEpochMillis: () => Date.parse("2026-08-12T00:00:00.000Z"),
      })
    )

    expect(connectNats).toHaveBeenCalledWith(
      config.natsServers,
      [subjects.library.listEpisodes, subjects.library.createAudioAccess],
      config.queueGroup
    )
    expect(events).toEqual([
      `receive:${subjects.library.listEpisodes}`,
      `reply:${subjects.library.listEpisodes}`,
      `receive:${subjects.library.createAudioAccess}`,
      `reply:${subjects.library.createAudioAccess}`,
      "drain",
    ])
    const envelopes = await Promise.all(
      replies.map((reply) =>
        Effect.runPromise(parseMessageEnvelope(JSON.parse(reply) as unknown))
      )
    )
    expect(
      await Effect.runPromise(parseListEpisodesReply(envelopes[0]!.payload))
    ).toMatchObject({ _tag: "Listed" })
    expect(
      await Effect.runPromise(
        parseCreateAudioAccessReply(envelopes[1]!.payload)
      )
    ).toMatchObject({ _tag: "Found" })
    expect(signer.issue).toHaveBeenCalledOnce()
    expect(drain).toHaveBeenCalledOnce()
  })

  it("rejects invalid config before connecting", async () => {
    const connectNats = vi.fn()
    const exit = await Effect.runPromiseExit(
      runNodeEpisodeLibraryRpc(
        { ...config, natsServers: ["https://not-nats.test"] },
        { issue: vi.fn() },
        {
          connectNats,
          newMessageId: () => "unused",
          now: () => "unused",
          nowEpochMillis: () => 0,
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(connectNats).not.toHaveBeenCalled()
  })

  it("drains NATS when a reply fails", async () => {
    const drain = vi.fn(async () => undefined)
    let delivered = false
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        if (delivered) return undefined
        delivered = true
        return {
          ...request(
            subjects.library.listEpisodes,
            {},
            "10e2d4e1-c127-479f-a124-2ea037bd9319"
          ),
          reply: () => Promise.reject(new Error("reply failed")),
        }
      },
      drain,
    }
    const exit = await Effect.runPromiseExit(
      runNodeEpisodeLibraryRpc(
        { ...config, sqlitePath: ":memory:" },
        { issue: vi.fn() },
        {
          connectNats: async () => server,
          newMessageId: () => "b3ec6a98-bc73-4c94-a3bf-7e8cc8e5f02a",
          now: () => "2026-08-12T00:00:01.000Z",
          nowEpochMillis: () => 0,
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(drain).toHaveBeenCalledOnce()
  })

  it("classifies NATS acquisition failure without invoking the signer", async () => {
    const signer = { issue: vi.fn() }
    const exit = await Effect.runPromiseExit(
      runNodeEpisodeLibraryRpc({ ...config, sqlitePath: ":memory:" }, signer, {
        connectNats: () => Promise.reject(new Error("connection refused")),
        newMessageId: () => "unused",
        now: () => "unused",
        nowEpochMillis: () => 0,
      })
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") expect(String(exit.cause)).toContain("Nats")
    expect(signer.issue).not.toHaveBeenCalled()
  })

  it("parses and freezes runtime configuration", async () => {
    const parsed = await Effect.runPromise(
      parseNodeEpisodeLibraryRpcConfig(config)
    )
    expect(parsed).toEqual(config)
    expect(Object.isFrozen(parsed.natsServers)).toBe(true)
  })

  it("closes SQLite, NATS, and the signer client on interruption", async () => {
    const events: string[] = []
    const server: UnsafeNatsRpcServer = {
      receive: () => new Promise(() => undefined),
      drain: async () => void events.push("nats.closed"),
    }
    const signer = { issue: vi.fn() }
    const fiber = Effect.runFork(
      runNodeEpisodeLibraryService(
        {
          ...serviceConfig,
          sqlitePath: ":memory:",
          s3: {
            endpoint: "http://seaweedfs:8333",
            region: "us-east-1",
            bucket: "private-audio",
            accessKeyId: "access-id",
            secretAccessKey: "secret-key",
          },
        },
        {
          openSigner: () => ({
            signer,
            close: Effect.sync(() => void events.push("signer.closed")),
          }),
          rpcDependencies: {
            connectNats: async () => {
              events.push("nats.opened")
              return server
            },
            newMessageId: () => "unused",
            now: () => "unused",
            nowEpochMillis: () => 0,
            makeRepository: () => ({
              listPageByOwner: () => Effect.succeed([]),
              findByOwner: () => Effect.succeed(undefined),
              saveOnce: () => Effect.succeed("Stored"),
              backupTo: () => Effect.succeed(1),
              close: Effect.sync(() => void events.push("sqlite.closed")),
            }),
          },
          connectCompletionConsumer: async () =>
            ({
              receive: () => new Promise(() => undefined),
              drain: async () => void events.push("consumer.closed"),
            }) satisfies UnsafeEpisodeCompletedConsumer,
        }
      )
    )

    await vi.waitFor(() => expect(events).toContain("nats.opened"))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(events).toEqual([
      "nats.opened",
      "consumer.closed",
      "nats.closed",
      "sqlite.closed",
      "signer.closed",
    ])
  })
})
