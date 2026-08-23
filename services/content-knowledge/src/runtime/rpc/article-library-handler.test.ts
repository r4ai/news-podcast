import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  makeArticleLibraryHandler,
  type ArticleLibraryHandlerDependencies,
} from "./article-library-handler.js"

const dependencies = () => ({
  articles: {
    list: vi.fn(() => Effect.succeed([])),
    find: vi.fn(() => Effect.succeed({ _tag: "NotFound" })),
    findSnapshot: vi.fn(() => Effect.succeed({ _tag: "NotFound" })),
    findMarkdown: vi.fn(() => Effect.succeed({ _tag: "NotFound" })),
    findSnapshotMarkdown: vi.fn(() => Effect.succeed({ _tag: "NotFound" })),
    patch: vi.fn(() => Effect.succeed({ _tag: "NotFound" })),
    bulkPatch: vi.fn(() => Effect.succeed(0)),
    facets: vi.fn(() =>
      Effect.succeed({
        states: { all: 0, unread: 0, saved: 0, later: 0 },
        feeds: [],
      })
    ),
  },
  objects: { read: vi.fn() },
  now: () => "2026-08-13T02:00:00.000Z",
  deriveArchiveRequestId: vi.fn(),
  archive: vi.fn(),
})

describe("article library handler", () => {
  it("fails closed on malformed owner, IDs, defaults, and excess properties", async () => {
    const ports = dependencies()
    const handler = makeArticleLibraryHandler(
      ports as unknown as ArticleLibraryHandlerDependencies
    )
    for (const input of [
      {},
      { ownerId: "owner-a", articleId: "not-a-uuid" },
      {
        ownerId: "owner-a",
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
        ownerOverride: "owner-b",
      },
    ]) {
      await expect(
        Effect.runPromise(handler.find(input))
      ).rejects.toMatchObject({
        _tag: "ArticleLibraryRequestRejected",
      })
    }
    expect(ports.articles.find).not.toHaveBeenCalled()
  })

  it("refuses continuation cursors it cannot decode", async () => {
    const ports = dependencies()
    const handler = makeArticleLibraryHandler(
      ports as unknown as ArticleLibraryHandlerDependencies
    )
    const query = {
      state: "All",
      includeHidden: false,
      feedIds: [],
      limit: 50,
      order: "Newest",
    }
    for (const cursor of [
      "",
      "tampered",
      Buffer.from(JSON.stringify({ sortKey: "2026-08-13" }), "utf8").toString(
        "base64url"
      ),
    ]) {
      await expect(
        Effect.runPromise(
          handler.list({ ownerId: "owner-a", query: { ...query, cursor } })
        )
      ).rejects.toMatchObject({ _tag: "ArticleLibraryRequestRejected" })
    }
    expect(ports.articles.list).not.toHaveBeenCalled()

    const cursor = Buffer.from(
      JSON.stringify({
        sortKey: "2026-08-13T00:00:00.000Z",
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      }),
      "utf8"
    ).toString("base64url")
    await Effect.runPromise(
      handler.list({ ownerId: "owner-a", query: { ...query, cursor } })
    )
    expect(ports.articles.list).toHaveBeenCalledWith("owner-a", {
      ...query,
      cursor,
    })
  })

  it("accepts only a non-empty patch and supplies the service clock", async () => {
    const ports = dependencies()
    const handler = makeArticleLibraryHandler(
      ports as unknown as ArticleLibraryHandlerDependencies
    )
    await expect(
      Effect.runPromise(
        handler.patch({
          ownerId: "owner-a",
          articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
          patch: {},
        })
      )
    ).rejects.toMatchObject({ _tag: "ArticleLibraryRequestRejected" })

    await Effect.runPromise(
      handler.patch({
        ownerId: "owner-a",
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
        patch: { hidden: true },
      })
    )
    expect(ports.articles.patch).toHaveBeenCalledWith(
      "owner-a",
      "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      { hidden: true },
      "2026-08-13T02:00:00.000Z"
    )
  })

  it("routes every validated read and bulk operation to its narrow port", async () => {
    const ports = dependencies()
    const handler = makeArticleLibraryHandler(
      ports as unknown as ArticleLibraryHandlerDependencies
    )
    const identity = {
      ownerId: "owner-a",
      articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    }
    const snapshotIdentity = {
      ...identity,
      snapshotId: "651b86e0-481a-42e2-aef4-7b6419d7447a",
    }
    const filter = { includeHidden: false, feedIds: [] }
    const listQuery = {
      ...filter,
      state: "All",
      limit: 50,
      order: "Newest",
    }

    await Effect.runPromise(
      handler.list({ ownerId: identity.ownerId, query: listQuery })
    )
    await Effect.runPromise(handler.find(identity))
    await Effect.runPromise(handler.findSnapshot(snapshotIdentity))
    await Effect.runPromise(handler.markdown(identity))
    await Effect.runPromise(handler.snapshotMarkdown(snapshotIdentity))
    await Effect.runPromise(
      handler.bulkPatch({
        ownerId: identity.ownerId,
        query: { ...filter, state: "All" },
        patch: { read: true },
      })
    )
    await Effect.runPromise(
      handler.facets({ ownerId: identity.ownerId, query: filter })
    )
    await Effect.runPromise(handler.archive(identity, {} as never))

    expect(ports.articles.list).toHaveBeenCalledOnce()
    expect(ports.articles.find).toHaveBeenCalledTimes(2)
    expect(ports.articles.findSnapshot).toHaveBeenCalledWith(
      identity.ownerId,
      identity.articleId,
      snapshotIdentity.snapshotId
    )
    expect(ports.articles.findMarkdown).toHaveBeenCalledOnce()
    expect(ports.articles.findSnapshotMarkdown).toHaveBeenCalledWith(
      identity.ownerId,
      identity.articleId,
      snapshotIdentity.snapshotId
    )
    expect(ports.articles.bulkPatch).toHaveBeenCalledOnce()
    expect(ports.articles.facets).toHaveBeenCalledOnce()
  })
})
