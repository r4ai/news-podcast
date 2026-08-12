import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { createContentTaxonomy } from "../application/content-taxonomy.js"
import { CapturedAtSchema, type ArticleId } from "../domain/article.js"
import { TagIdSchema, TagNameSchema } from "../domain/content-taxonomy.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { createSqliteContentTaxonomy } from "./sqlite-content-taxonomy.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const databases: ReturnType<typeof openSqliteUnsafe>[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const articleA = "5af55f2e-ff0b-475c-866a-f2cff48c101d" as ArticleId
const now = decode(CapturedAtSchema, "2026-08-13T01:00:00.000Z")

const setup = async () => {
  const database = openSqliteUnsafe(":memory:")
  databases.push(database)
  database.execute(`
    CREATE TABLE feed_catalog (
      feed_id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE feed_subscriptions (
      subscription_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
      feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id), created_at TEXT NOT NULL,
      UNIQUE(owner_id, feed_id)
    ) STRICT;
    CREATE TABLE feed_items (
      article_id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id),
      external_id TEXT NOT NULL, source_url TEXT NOT NULL, title TEXT NOT NULL,
      published_at TEXT, discovered_at TEXT NOT NULL, UNIQUE(feed_id, external_id)
    ) STRICT;
    INSERT INTO feed_catalog VALUES ('feed-a', 'https://a.example/feed', '${now}');
    INSERT INTO feed_catalog VALUES ('feed-b', 'https://b.example/feed', '${now}');
    INSERT INTO feed_subscriptions VALUES ('sub-a', 'owner-a', 'feed-a', '${now}');
    INSERT INTO feed_subscriptions VALUES ('sub-b', 'owner-b', 'feed-b', '${now}');
    INSERT INTO feed_items VALUES ('${articleA}', 'feed-a', 'a', 'https://a.example/a', 'A', NULL, '${now}');
  `)
  const repository = await Effect.runPromise(
    createSqliteContentTaxonomy(database)
  )
  let sequence = 0
  const tagIds = [
    "58e1ed93-2a74-410c-8a13-a29b8158be5e",
    "70ea4796-e50f-4503-87e5-ceb25ebd057f",
    "f050b0a9-2dd6-49fc-b78c-15d88b99127a",
  ]
  const operations = createContentTaxonomy({
    repository,
    newTagId: () => decode(TagIdSchema, tagIds[sequence++]!),
    now: () => now,
  })
  return { database, repository, operations }
}

describe("SQLite content taxonomy", () => {
  it("creates idempotently per owner and never leaks vocabulary", async () => {
    const { operations } = await setup()
    const ai = decode(TagNameSchema, "AI")

    const first = await Effect.runPromise(operations.createTag(ownerA, ai))
    const repeated = await Effect.runPromise(operations.createTag(ownerA, ai))
    const other = await Effect.runPromise(operations.createTag(ownerB, ai))

    expect(repeated).toEqual(first)
    expect(other.tagId).not.toBe(first.tagId)
    expect(await Effect.runPromise(operations.listTags(ownerA))).toEqual([
      first,
    ])
    expect(await Effect.runPromise(operations.listTags(ownerB))).toEqual([
      other,
    ])
  })

  it("replaces manual tags atomically and rejects cross-owner tags without mutation", async () => {
    const { operations } = await setup()
    const ai = await Effect.runPromise(
      operations.createTag(ownerA, decode(TagNameSchema, "AI"))
    )
    const other = await Effect.runPromise(
      operations.createTag(ownerB, decode(TagNameSchema, "Other"))
    )

    expect(
      await Effect.runPromise(
        operations.setArticleTags(ownerA, articleA, [ai.tagId])
      )
    ).toMatchObject({ _tag: "Updated" })
    expect(
      await Effect.runPromise(
        operations.setArticleTags(ownerA, articleA, [other.tagId])
      )
    ).toEqual({ _tag: "UnknownTags", tagIds: [other.tagId] })
    expect(
      await Effect.runPromise(operations.listArticleTags(ownerA, articleA))
    ).toEqual([expect.objectContaining({ tagId: ai.tagId, source: "Manual" })])
    expect(
      await Effect.runPromise(
        operations.setArticleTags(ownerB, articleA, [other.tagId])
      )
    ).toEqual({ _tag: "ArticleNotFound" })
  })

  it("keeps AI and manual assignments consistent and promotes suggestions atomically", async () => {
    const { repository, operations } = await setup()
    const tag = await Effect.runPromise(
      operations.createTag(ownerA, decode(TagNameSchema, "Known"))
    )
    await Effect.runPromise(
      operations.setArticleTags(ownerA, articleA, [tag.tagId])
    )
    await Effect.runPromise(
      repository.applyAiTags(
        ownerA,
        articleA,
        [{ name: tag.name, confidence: 0.8 }],
        [
          decode(TagNameSchema, "New topic"),
          decode(TagNameSchema, "New topic"),
        ],
        now
      )
    )

    expect(await Effect.runPromise(operations.listSuggestions(ownerA))).toEqual(
      [{ name: "New topic", occurrences: 1, lastSeenAt: now }]
    )
    const promoted = await Effect.runPromise(
      operations.promoteSuggestion(ownerA, decode(TagNameSchema, "New topic"))
    )
    expect(promoted).toMatchObject({
      _tag: "Promoted",
      tag: { name: "New topic" },
    })
    expect(await Effect.runPromise(operations.listSuggestions(ownerA))).toEqual(
      []
    )
    expect(
      await Effect.runPromise(
        operations.promoteSuggestion(ownerB, decode(TagNameSchema, "New topic"))
      )
    ).toEqual({ _tag: "NotFound" })
  })
})
