import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseArticleLibraryReply,
  parseArticleLibraryRequest,
} from "./article-library-rpc.js"

const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"
const feedId = "0c6bd9aa-f349-4c16-af84-acb845aa9d47"

describe("article library RPC", () => {
  it("accepts bounded owner-free operations", async () => {
    const list = await Effect.runPromise(
      parseArticleLibraryRequest({
        operation: "List",
        query: {
          limit: 50,
          state: "All",
          includeHidden: false,
          feedIds: [feedId],
          order: "Newest",
        },
      })
    )
    expect(list.operation).toBe("List")
    expect(list).not.toHaveProperty("ownerId")
  })

  it("carries an opaque continuation cursor and bounds its shape", async () => {
    const cursor = "cG9zaXRpb24"
    const listed = await Effect.runPromise(
      parseArticleLibraryRequest({
        operation: "List",
        query: {
          limit: 50,
          state: "All",
          includeHidden: false,
          feedIds: [],
          order: "Newest",
          cursor,
        },
      })
    )
    expect(listed).toMatchObject({ query: { cursor } })

    for (const invalid of ["", "not base64url!", "a".repeat(600)]) {
      await expect(
        Effect.runPromise(
          parseArticleLibraryRequest({
            operation: "List",
            query: {
              limit: 50,
              state: "All",
              includeHidden: false,
              feedIds: [],
              order: "Newest",
              cursor: invalid,
            },
          })
        )
      ).rejects.toBeDefined()
    }
  })

  it("rejects empty patches, duplicate feed filters, and forged owners", async () => {
    for (const request of [
      { operation: "Patch", articleId, patch: {} },
      {
        operation: "List",
        query: {
          limit: 50,
          state: "All",
          includeHidden: false,
          feedIds: [feedId, feedId],
          order: "Newest",
        },
      },
      { operation: "Find", articleId, ownerId: "victim" },
    ]) {
      await expect(
        Effect.runPromise(parseArticleLibraryRequest(request))
      ).rejects.toBeDefined()
    }
  })

  it("accepts finite article and facets replies", async () => {
    const reply = await Effect.runPromise(
      parseArticleLibraryReply({
        _tag: "Listed",
        articles: [
          {
            articleId,
            feedId,
            title: "News",
            sourceUrl: "https://example.com/news",
            publishedAt: null,
            discoveredAt: "2026-08-13T00:00:00.000Z",
            archiveStatus: "Pending",
            snapshotId: null,
            state: {
              read: false,
              saved: false,
              readLater: false,
              hidden: false,
              hiddenAt: null,
            },
          },
        ],
        nextCursor: null,
      })
    )
    expect(reply._tag).toBe("Listed")
    if (reply._tag === "Listed") {
      expect(Object.isFrozen(reply.articles)).toBe(true)
      expect(reply.nextCursor).toBeNull()
    }
  })

  it("requires the listed reply to state whether a further page exists", async () => {
    await expect(
      Effect.runPromise(
        parseArticleLibraryReply({ _tag: "Listed", articles: [] })
      )
    ).rejects.toBeDefined()
    expect(
      await Effect.runPromise(
        parseArticleLibraryReply({
          _tag: "Listed",
          articles: [],
          nextCursor: "cG9zaXRpb24",
        })
      )
    ).toMatchObject({ _tag: "Listed" })
  })
})
