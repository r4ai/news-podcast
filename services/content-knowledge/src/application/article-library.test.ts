import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  parseArticleListQuery,
  parseArticleStatePatch,
  triggerOwnerArticleArchive,
} from "./article-library.js"

const context = {
  messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4",
  correlationId: "ea122752-73d0-4851-9664-7d3e63e76859",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: { _tag: "User", userId: "owner-a" },
} as never

it("rejects NUL in an article search query before FTS", async () => {
  await expect(
    Effect.runPromise(
      parseArticleListQuery({
        limit: 50,
        state: "All",
        includeHidden: false,
        feedIds: [],
        q: "abc\0def",
        order: "Newest",
      })
    )
  ).rejects.toBeDefined()
})

describe("triggerOwnerArticleArchive", () => {
  it("rejects an empty or excess-property state patch", async () => {
    await expect(
      Effect.runPromise(parseArticleStatePatch({}))
    ).rejects.toBeDefined()
    await expect(
      Effect.runPromise(
        parseArticleStatePatch({ read: true, ownerId: "other" })
      )
    ).rejects.toBeDefined()
  })

  it("does not reveal or capture an article outside the owner boundary", async () => {
    const archive = vi.fn()
    const result = await Effect.runPromise(
      triggerOwnerArticleArchive({
        articles: { find: () => Effect.succeed({ _tag: "NotFound" }) },
        deriveArchiveRequestId: vi.fn(),
        archive,
      })({
        ownerId: "owner-b" as never,
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
        context,
      })
    )

    expect(result).toEqual({ _tag: "NotFound" })
    expect(archive).not.toHaveBeenCalled()
  })

  it("derives a refresh intent from article and RPC message identity", async () => {
    const snapshot = { articleId: "unused" }
    const archive = vi.fn(() =>
      Effect.succeed({ _tag: "AlreadyArchived", snapshot } as never)
    )
    const deriveArchiveRequestId = vi.fn(
      () => "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93" as never
    )
    const result = await Effect.runPromise(
      triggerOwnerArticleArchive({
        articles: {
          find: () =>
            Effect.succeed({
              _tag: "Found",
              article: {
                articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
                sourceUrl: "https://news.example.com/a",
                title: "Article",
              },
            } as never),
        },
        deriveArchiveRequestId,
        archive,
      })({
        ownerId: "owner-a" as never,
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
        context,
      })
    )

    expect(result).toEqual({ _tag: "AlreadyArchived", snapshot })
    expect(deriveArchiveRequestId).toHaveBeenCalledWith({
      articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4",
    })
    expect(archive).toHaveBeenCalledWith({
      command: {
        archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
        articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
        sourceUrl: "https://news.example.com/a",
        title: "Article",
      },
      context,
    })
  })
})
