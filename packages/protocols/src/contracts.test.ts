import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseArticleArchived,
  parseCreateEpisodeJobRequest,
  parseEpisodeCompleted,
  parseResolveSessionResponse,
} from "./contracts.js"

describe("integration contracts", () => {
  it("parses the cross-context happy paths into immutable values", async () => {
    const [session, request, article, episode] = await Effect.runPromise(
      Effect.all([
        parseResolveSessionResponse({
          actor: {
            _tag: "User",
            userId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
          },
        }),
        parseCreateEpisodeJobRequest({
          idempotencyKey: "daily-2026-08-12",
          trigger: "manual",
        }),
        parseArticleArchived({
          _tag: "ArticleArchived",
          archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
          articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
          snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
          sourceUrl: "https://example.com/news/1",
          title: "News 1",
          archivedAt: "2026-08-12T00:00:00.000Z",
          markdown: {
            _tag: "Markdown",
            key: "articles/snapshot/markdown/article.md",
            sha256: "3".repeat(64),
            mediaType: "text/markdown",
            byteLength: 80,
          },
        }),
        parseEpisodeCompleted({
          episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
          ownerId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
          audioObjectKey: "episodes/user/episode.wav",
          title: "Daily news",
          sources: [
            {
              url: "https://example.com/news/1",
              title: "News 1",
            },
          ],
        }),
      ])
    )

    expect(session.actor._tag).toBe("User")
    expect(request.trigger).toBe("manual")
    expect(article.sourceUrl).toBe("https://example.com/news/1")
    expect(Object.isFrozen(article.markdown)).toBe(true)
    expect(Object.isFrozen(episode.sources[0])).toBe(true)
  })

  const invalidCases: ReadonlyArray<
    readonly [string, () => Effect.Effect<unknown, unknown>]
  > = [
    [
      "session user without id",
      () => parseResolveSessionResponse({ actor: { _tag: "User" } }),
    ],
    [
      "command with forged owner",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
          ownerId: "forged",
        }),
    ],
    [
      "archive with non-http URL",
      () =>
        parseArticleArchived({
          _tag: "ArticleArchived",
          archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
          articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
          snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
          sourceUrl: "file:///etc/passwd",
          title: "News 1",
          archivedAt: "2026-08-12T00:00:00.000Z",
          markdown: {
            _tag: "Markdown",
            key: "articles/snapshot/markdown/article.md",
            sha256: "3".repeat(64),
            mediaType: "text/markdown",
            byteLength: 80,
          },
        }),
    ],
    [
      "completed episode without sources",
      () =>
        parseEpisodeCompleted({
          episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
          ownerId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
          audioObjectKey: "episodes/user/episode.wav",
          title: "Daily news",
          sources: [],
        }),
    ],
  ]

  it.each(invalidCases)("rejects %s", async (_case, parseInvalid) => {
    const exit = await Effect.runPromiseExit(parseInvalid())
    expect(exit._tag).toBe("Failure")
  })
})
