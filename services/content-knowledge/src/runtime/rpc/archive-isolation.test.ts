import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { createArchiveRefreshQueue } from "../../adapters/persistence/archive-refresh/repository.js"
import { openTestDatabase } from "../../adapters/persistence/testing.js"
import { makeArticleLibraryHandler } from "./article-library-handler.js"
import { runNatsContentKnowledgeRpc } from "./nats-server.js"
import { deriveManualArchiveRequestIdUnsafe } from "../../infrastructure/unsafe/identity.js"

it("serves owner B reads while owner A capture remains blocked", async () => {
  const db = openTestDatabase()
  const articleId = randomUUID(),
    feedId = randomUUID()
  const now = () => new Date().toISOString()
  db.runSql(
    "INSERT INTO feed_catalog(feed_id, feed_url, created_at) VALUES (?, ?, ?)",
    [feedId, "https://example.com/feed", now()]
  )
  db.runSql(
    "INSERT INTO feed_items(article_id, feed_id, external_id, source_url, title, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      articleId,
      feedId,
      articleId,
      "https://example.com/article",
      "Article",
      now(),
    ]
  )
  const queue = createArchiveRefreshQueue(db.db, randomUUID)
  let resolveStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  const events: string[] = []
  const library = makeArticleLibraryHandler({
    articles: {
      find: () =>
        Effect.succeed({
          _tag: "Found",
          article: {
            articleId,
            sourceUrl: "https://example.com/article",
            title: "Article",
          },
        }),
      list: () =>
        Effect.sync(() => {
          events.push("list")
          return { items: [], nextCursor: null }
        }),
    } as never,
    objects: {} as never,
    now: now as never,
    deriveArchiveRequestId: deriveManualArchiveRequestIdUnsafe,
    archiveQueue: queue,
    archive: () =>
      Effect.sync(() => {
        events.push("capture:start")
        resolveStarted()
      }).pipe(Effect.andThen(Effect.never)),
  })
  const envelope = (ownerId: string, payload: unknown, producer = "gateway") =>
    JSON.stringify({
      messageId: randomUUID(),
      correlationId: randomUUID(),
      causationId: randomUUID(),
      occurredAt: now(),
      producer,
      actor: { _tag: "User", userId: ownerId },
      traceparent: "00-123e4567e89b42d3a456426614174000-123e4567e89b42d3-01",
      payload,
    })
  const replies: { payload: { _tag: string } }[] = []
  let index = 0
  try {
    await Effect.runPromiseExit(
      runNatsContentKnowledgeRpc(
        { natsServers: [], queueGroup: "test" },
        {
          articles: {} as never,
          subscriptions: {
            list: () =>
              Effect.sync(() => {
                events.push("subscriptions")
                return []
              }),
          } as never,
        },
        {} as never,
        {
          connect: async () => ({
            receive: async () => {
              const current = index++
              if (current === 0)
                return {
                  subject: "content.article-library.v1",
                  payload: envelope("owner-a", {
                    operation: "Archive",
                    articleId,
                    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
                  }),
                  reply: async (payload: string) => {
                    replies.push(JSON.parse(payload))
                  },
                }
              if (current === 1) {
                await Promise.race([
                  started,
                  new Promise((_, reject) =>
                    setTimeout(
                      () => reject(new Error("capture did not start")),
                      1000
                    )
                  ),
                ])
                return {
                  subject: "content.article-library.v1",
                  payload: envelope("owner-b", {
                    operation: "List",
                    query: {
                      limit: 10,
                      state: "All",
                      includeHidden: false,
                      feedIds: [],
                      order: "Newest",
                    },
                  }),
                  reply: async (payload: string) => {
                    replies.push(JSON.parse(payload))
                  },
                }
              }
              if (current === 2)
                return {
                  subject: "content.list-subscriptions.v1",
                  payload: envelope("owner-b", {}),
                  reply: async (payload: string) => {
                    replies.push(JSON.parse(payload))
                  },
                }
              if (current === 3)
                return {
                  subject: "content.plan-generation.v1",
                  payload: envelope(
                    "owner-b",
                    { selection: { _tag: "Automatic" } },
                    "episode-production"
                  ),
                  reply: async (payload: string) => {
                    replies.push(JSON.parse(payload))
                  },
                }
              return undefined
            },
            drain: async () => undefined,
          }),
          newMessageId: randomUUID,
          newSubscriptionIdentity: (() => undefined) as never,
          now,
        },
        library,
        undefined,
        () =>
          Effect.sync(() => {
            events.push("planning")
            return { _tag: "NoCandidates" as const }
          })
      )
    )
    expect(replies.map((reply) => reply.payload._tag)).toEqual([
      "ArchiveAccepted",
      "Listed",
      "Listed",
      "NoCandidates",
    ])
    expect(events).toEqual([
      "capture:start",
      "list",
      "subscriptions",
      "planning",
    ])
  } finally {
    db.close()
  }
})
