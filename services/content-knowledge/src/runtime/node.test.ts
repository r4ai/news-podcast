import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import { openContentKnowledgeDatabaseUnsafe } from "../infrastructure/unsafe/drizzle/open.js"
import {
  parseNodeRuntimeConfig,
  runNodeService,
  startNodeRuntime,
  type NodeRuntimeDependencies,
} from "./node.js"

const validConfig = {
  sqlitePath: ":memory:",
  natsServers: ["nats://127.0.0.1:4222"],
}

const validServiceConfig = {
  ...validConfig,
  rpc: { queueGroup: "content-rpc" },
  feedPoller: {
    http: { timeoutMillis: 1_000, maximumBytes: 8_192 },
    loop: {
      intervalMillis: 1_000,
      initialBackoffMillis: 100,
      maximumBackoffMillis: 1_000,
    },
  },
  enrichment: {
    dailyLimit: 200,
    provider: null,
    loop: {
      intervalMillis: 1_000,
      initialBackoffMillis: 100,
      maximumBackoffMillis: 1_000,
    },
  },
  archive: {
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    bucket: "news-podcast",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    timeoutMillis: 1_000,
    maximumHtmlBytes: 8_192,
  },
}

const makeDependencies = (): NodeRuntimeDependencies => ({
  openDatabase: openContentKnowledgeDatabaseUnsafe,
  newJobId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed21"),
  now: vi.fn(() => "2026-08-12T00:01:00.000Z" as never),
  newTagId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed20" as never),
  newEnrichmentLeaseToken: vi.fn(() => "lease-token-0001"),
})

describe("content-knowledge Node runtime", () => {
  it("parses and freezes runtime configuration before opening resources", async () => {
    const config = await Effect.runPromise(parseNodeRuntimeConfig(validConfig))
    expect(config).toEqual(validConfig)
    expect(Object.isFrozen(config.natsServers)).toBe(true)
  })

  it("rejects invalid configuration without opening SQLite", async () => {
    const openDatabase = vi.fn(openContentKnowledgeDatabaseUnsafe)
    const exit = await Effect.runPromiseExit(
      startNodeRuntime(
        { ...validConfig, natsServers: ["https://nats.example.com"] },
        { ...makeDependencies(), openDatabase }
      )
    )
    expect(exit._tag).toBe("Failure")
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it("owns only SQLite and no longer acquires the retired Content JetStream", async () => {
    const closeSqlite = vi.fn()
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, {
        ...makeDependencies(),
        openDatabase: () => ({ ...database, close: closeSqlite }),
      })
    )

    expect(runtime.store).toBeDefined()
    expect("relayOnce" in runtime).toBe(false)
    await Effect.runPromise(runtime.close())
    expect(closeSqlite).toHaveBeenCalledOnce()
    database.close()
  })

  it("reports SQLite close exceptions as a typed shutdown failure", async () => {
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, {
        ...makeDependencies(),
        openDatabase: () => ({
          ...database,
          close: () => {
            throw new Error("disk close failure")
          },
        }),
      })
    )
    expect(await Effect.runPromise(Effect.flip(runtime.close()))).toEqual({
      _tag: "ContentKnowledgeRuntimeFailed",
      component: "Sqlite",
    })
    database.close()
  })

  it("becomes ready only after the RPC resource is acquired and drains on interrupt", async () => {
    const closeSqlite = vi.fn()
    const ready = vi.fn()
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const fiber = Effect.runFork(
      runNodeService(validServiceConfig, {
        startRuntime: (input) =>
          startNodeRuntime(input, {
            ...makeDependencies(),
            openDatabase: () => ({ ...database, close: closeSqlite }),
          }),
        openCapture: () => ({
          capture: vi.fn(),
          fetcher: vi.fn() as never,
          close: Effect.void,
        }),
        openMarkdownReader: () =>
          ({ reader: { read: vi.fn() }, close: Effect.void }) as never,
        runRpc: (config) =>
          Effect.sync(() => config.onReady?.()).pipe(
            Effect.andThen(Effect.never)
          ),
        runPoller: () => Effect.never,
        enrichmentProvider: { enrich: () => Effect.die("unused") },
        runEnrichment: () => Effect.never,
        onReady: ready,
      })
    )

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(closeSqlite).toHaveBeenCalledOnce()
    database.close()
  })
})
