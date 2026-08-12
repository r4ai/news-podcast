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
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AudioAccessSigner } from "../application/ports.js"
import { InboxMessageIdSchema } from "../domain/episode-completion.js"
import { CompletedEpisodeSchema } from "../domain/episode.js"
import { makeSqliteEpisodeRepository } from "../infrastructure/index.js"
import type { UnsafeNatsRpcServer } from "../infrastructure/unsafe/nats-rpc.js"
import {
  parseNodeEpisodeLibraryRpcConfig,
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

const request = (subject: string, payload: unknown, messageId: string) => ({
  subject,
  payload: JSON.stringify({
    messageId,
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "gateway",
    traceparent:
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "User", userId: ownerId },
    payload,
  }),
})

describe("episode-library Node RPC runtime", () => {
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
            parse(InboxMessageIdSchema)(
              "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
            )
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
      runNodeEpisodeLibraryRpc(
        { ...config, sqlitePath },
        signer,
        {
          connectNats,
          newMessageId: () => replyIds.shift()!,
          now: () => "2026-08-12T00:00:01.000Z",
          nowEpochMillis: () => Date.parse("2026-08-12T00:00:00.000Z"),
        }
      )
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
      runNodeEpisodeLibraryRpc(
        { ...config, sqlitePath: ":memory:" },
        signer,
        {
          connectNats: () => Promise.reject(new Error("connection refused")),
          newMessageId: () => "unused",
          now: () => "unused",
          nowEpochMillis: () => 0,
        }
      )
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
})
