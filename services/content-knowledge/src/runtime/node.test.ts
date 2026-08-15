import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { UnsafeJetStream } from "../infrastructure/unsafe/nats-jetstream.js"
import { openContentKnowledgeDatabaseUnsafe } from "../infrastructure/unsafe/drizzle/open.js"
import { unavailableEnrichmentProvider } from "./enrichment.js"
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
  relay: {
    batchSize: 10,
    intervalMillis: 1_000,
    initialBackoffMillis: 100,
    maximumBackoffMillis: 1_000,
  },
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

const makeJetStream = (close = vi.fn(async () => undefined)): UnsafeJetStream =>
  deepFreeze({
    publish: async () =>
      deepFreeze({ stream: "CONTENT_EVENTS", sequence: 1, duplicate: false }),
    close: () => close(),
  })

const makeDependencies = (
  jetStream: UnsafeJetStream
): NodeRuntimeDependencies => ({
  openDatabase: openContentKnowledgeDatabaseUnsafe,
  newJobId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed21"),
  connectJetStream: vi.fn(async () => jetStream),
  newMessageId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed19" as never),
  now: vi.fn(() => "2026-08-12T00:01:00.000Z" as never),
  newTagId: vi.fn(() => "8fb12955-2175-4675-be63-e42227d5ed20" as never),
  newEnrichmentLeaseToken: vi.fn(() => "lease-token-0001"),
})

describe("content-knowledge Node runtime", () => {
  it("parses and freezes runtime configuration before opening resources", async () => {
    const config = await Effect.runPromise(parseNodeRuntimeConfig(validConfig))

    expect(config).toEqual(validConfig)
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.natsServers)).toBe(true)
  })

  it("rejects invalid configuration without opening SQLite", async () => {
    const openDatabase = vi.fn(openContentKnowledgeDatabaseUnsafe)
    const dependencies = {
      ...makeDependencies(makeJetStream()),
      openDatabase,
    }

    const exit = await Effect.runPromiseExit(
      startNodeRuntime(
        { ...validConfig, natsServers: ["https://nats.example.com"] },
        dependencies
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it("starts the relay and closes both NATS and SQLite resources", async () => {
    const closeNats = vi.fn(async () => undefined)
    const jetStream = makeJetStream(closeNats)
    const closeSqlite = vi.fn()
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const dependencies: NodeRuntimeDependencies = {
      ...makeDependencies(jetStream),
      openDatabase: () =>
        // ORMハンドルを含む資源はdeepFreezeすると型が潰れる。
        Object.freeze({
          ...database,
          close: () => {
            closeSqlite()
          },
        }),
    }
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, dependencies)
    )

    expect(runtime.taxonomy).toBeDefined()
    expect(runtime.interestProfiles).toBeDefined()
    expect(runtime.createEnrichment).toBeTypeOf("function")
    const relayed = await Effect.runPromise(runtime.relayOnce(10))
    await Effect.runPromise(runtime.close())

    expect(relayed).toEqual({ published: 0, duplicates: 0 })
    expect(closeNats).toHaveBeenCalledOnce()
    expect(closeSqlite).toHaveBeenCalledOnce()
    database.close()
  })

  it("reports SQLite close exceptions as a typed shutdown failure", async () => {
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const dependencies: NodeRuntimeDependencies = {
      ...makeDependencies(makeJetStream()),
      openDatabase: () =>
        // ORMハンドルを含む資源はdeepFreezeすると型が潰れる。
        Object.freeze({
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

  it("durably records failure when the enrichment provider is unavailable", async () => {
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const runtime = await Effect.runPromise(
      startNodeRuntime(validConfig, {
        ...makeDependencies(makeJetStream()),
        openDatabase: () => database,
      })
    )
    database.client.exec(`
      INSERT INTO feed_catalog VALUES ('feed-a', 'https://a.example/feed', '2026-08-12T00:00:00.000Z');
      INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('sub-a', 'owner-a', 'feed-a', '2026-08-12T00:00:00.000Z');
      INSERT INTO feed_items VALUES (
        '5af55f2e-ff0b-475c-866a-f2cff48c101d', 'feed-a', 'external-a',
        'https://a.example/article', 'Article', NULL, '2026-08-12T00:00:00.000Z'
      );
      INSERT INTO article_snapshots(archive_request_id, snapshot_id, article_id, snapshot_json, captured_at) VALUES (
        'request-a', 'snapshot-a', '5af55f2e-ff0b-475c-866a-f2cff48c101d',
        '{"articleId":"5af55f2e-ff0b-475c-866a-f2cff48c101d","capture":{"markdown":{"key":"articles/a/article.md"}}}',
        '2026-08-12T00:00:00.000Z'
      );
    `)
    const enrichment = runtime.createEnrichment({
      source: { read: () => Effect.succeed("markdown") },
      provider: unavailableEnrichmentProvider,
      dailyLimit: 200,
    })

    expect(await Effect.runPromise(enrichment.runCycle())).toEqual({
      processed: 0,
    })
    expect(
      await Effect.runPromise(enrichment.status("owner-a" as never))
    ).toMatchObject({
      failed: {
        count: 1,
        items: [
          {
            status: "Failed",
            attempt: 4,
            error: "enrichment provider unavailable",
          },
        ],
      },
    })
    await Effect.runPromise(runtime.close())
  })

  it("closes NATS and SQLite when the continuous service is interrupted", async () => {
    const closeNats = vi.fn(async () => undefined)
    const closeSqlite = vi.fn()
    const database = openContentKnowledgeDatabaseUnsafe(":memory:")
    const runtimeDependencies: NodeRuntimeDependencies = {
      ...makeDependencies(makeJetStream(closeNats)),
      openDatabase: () =>
        // ORMハンドルを含む資源はdeepFreezeすると型が潰れる。
        Object.freeze({
          ...database,
          close: () => void closeSqlite(),
        }),
    }
    let cycleObserved = false
    const fiber = Effect.runFork(
      runNodeService(validServiceConfig, {
        startRuntime: (input) => startNodeRuntime(input, runtimeDependencies),
        openCapture: () => ({
          capture: vi.fn(),
          fetcher: vi.fn() as never,
          close: Effect.void,
        }),
        openMarkdownReader: () =>
          ({
            reader: { read: vi.fn() },
            close: Effect.void,
          }) as never,
        runRpc: () => Effect.never,
        runPoller: () => Effect.never,
        enrichmentProvider: {
          enrich: () => Effect.die("unused"),
        },
        runEnrichment: () => Effect.never,
        relayRuntime: {
          observe: () =>
            Effect.sync(() => {
              cycleObserved = true
            }),
          wait: () => Effect.never,
        },
      })
    )

    await vi.waitFor(() => expect(cycleObserved).toBe(true))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(closeNats).toHaveBeenCalledOnce()
    expect(closeSqlite).toHaveBeenCalledOnce()
    database.close()
  })
})
