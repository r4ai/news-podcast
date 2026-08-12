import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { UnsafeJetStream } from "../infrastructure/unsafe/nats-jetstream.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import {
  parseNodeRuntimeConfig,
  startNodeRuntime,
  type NodeRuntimeDependencies,
} from "./node.js"

const validConfig = {
  sqlitePath: ":memory:",
  natsServers: ["nats://127.0.0.1:4222"],
}

const makeJetStream = (close = vi.fn(async () => undefined)): UnsafeJetStream =>
  deepFreeze({
    publish: async () =>
      deepFreeze({ stream: "CONTENT_EVENTS", sequence: 1, duplicate: false }),
    close: () => close(),
  })

const makeDependencies = (
  jetStream: UnsafeJetStream
): NodeRuntimeDependencies => ({
  openSqlite: openSqliteUnsafe,
  connectJetStream: vi.fn(async () => jetStream),
  newMessageId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed19" as never),
  now: vi.fn(() => "2026-08-12T00:01:00.000Z" as never),
})

describe("content-knowledge Node runtime", () => {
  it("parses and freezes runtime configuration before opening resources", async () => {
    const config = await Effect.runPromise(parseNodeRuntimeConfig(validConfig))

    expect(config).toEqual(validConfig)
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.natsServers)).toBe(true)
  })

  it("rejects invalid configuration without opening SQLite", async () => {
    const openSqlite = vi.fn(openSqliteUnsafe)
    const dependencies = {
      ...makeDependencies(makeJetStream()),
      openSqlite,
    }

    const exit = await Effect.runPromiseExit(
      startNodeRuntime(
        { ...validConfig, natsServers: ["https://nats.example.com"] },
        dependencies
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(openSqlite).not.toHaveBeenCalled()
  })

  it("starts the relay and closes both NATS and SQLite resources", async () => {
    const closeNats = vi.fn(async () => undefined)
    const jetStream = makeJetStream(closeNats)
    const closeSqlite = vi.fn()
    const database = openSqliteUnsafe(":memory:")
    const dependencies: NodeRuntimeDependencies = {
      ...makeDependencies(jetStream),
      openSqlite: () =>
        deepFreeze({
          ...database,
          close: () => {
            closeSqlite()
          },
        }),
    }
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, dependencies)
    )

    const relayed = await Effect.runPromise(runtime.relayOnce(10))
    await Effect.runPromise(runtime.close())

    expect(relayed).toEqual({ published: 0, duplicates: 0 })
    expect(closeNats).toHaveBeenCalledOnce()
    expect(closeSqlite).toHaveBeenCalledOnce()
    database.close()
  })

  it("reports SQLite close exceptions as a typed shutdown failure", async () => {
    const database = openSqliteUnsafe(":memory:")
    const dependencies: NodeRuntimeDependencies = {
      ...makeDependencies(makeJetStream()),
      openSqlite: () =>
        deepFreeze({
          ...database,
          close: () => {
            throw new Error("disk close failure")
          },
        }),
    }
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, dependencies)
    )

    const error = await Effect.runPromise(Effect.flip(runtime.close()))

    expect(error).toEqual({
      _tag: "ContentKnowledgeRuntimeFailed",
      component: "Sqlite",
    })
    database.close()
  })
})
