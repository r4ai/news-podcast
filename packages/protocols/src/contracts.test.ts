import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseCreateEpisodeJobRequest,
  parseEpisodeCompleted,
  parseEpisodeCompletedV2,
  parseResolveSessionResponse,
} from "./contracts.js"

describe("integration contracts", () => {
  it("requires and preserves the article selection fixed at acceptance", async () => {
    const selected = await Effect.runPromise(
      parseCreateEpisodeJobRequest({
        idempotencyKey: "selected",
        trigger: "manual",
        articleIds: [
          "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
          "3c4d046c-b47b-4047-a562-66ac7e74e995",
        ],
      })
    )

    expect(selected.articleIds).toEqual([
      "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      "3c4d046c-b47b-4047-a562-66ac7e74e995",
    ])
    expect(Object.isFrozen(selected.articleIds)).toBe(true)
  })

  it("preserves an opaque authenticated owner in completion events", async () => {
    const completion = await Effect.runPromise(
      parseEpisodeCompleted({
        episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
        ownerId: "better-auth-user_01",
        audioObjectKey: "episodes/opaque/episode.wav",
        title: "Daily news",
        sources: [{ url: "https://example.com/news", title: "News" }],
      })
    )

    expect(completion.ownerId).toBe("better-auth-user_01")
  })

  it("preserves every field required to materialize a completed episode", async () => {
    const completion = await Effect.runPromise(
      parseEpisodeCompletedV2({
        episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
        ownerId: "better-auth-user_01",
        title: "Daily news",
        script: "The verified news script.",
        audio: {
          objectKey: "episodes/opaque/episode.wav",
          byteLength: 42,
          contentType: "audio/wav",
        },
        sources: [
          {
            sourceKind: "rss",
            snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
            url: "https://example.com/news",
            title: "News",
            publishedAt: "2026-08-12T00:00:00.000Z",
          },
        ],
        completedAt: "2026-08-12T01:00:00.000Z",
      })
    )

    expect(completion.script).toBe("The verified news script.")
    expect(completion.audio.byteLength).toBe(42)
    expect(completion.sources[0]?.snapshotId).toBe(
      "3c4d046c-b47b-4047-a562-66ac7e74e995"
    )
    expect(Object.isFrozen(completion.audio)).toBe(true)
  })

  it("parses the cross-context happy paths into immutable values", async () => {
    const [session, request, episode] = await Effect.runPromise(
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
          articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
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
      "command without an article snapshot",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
        }),
    ],
    [
      "external scheduled command",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "scheduled",
          articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
        }),
    ],
    [
      "command with forged owner",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
          articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
          ownerId: "forged",
        }),
    ],
    [
      "command with empty explicit article selection",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
          articleIds: [],
        }),
    ],
    [
      "command with a non-UUID article",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
          articleIds: ["article-1"],
        }),
    ],
    [
      "command with more than twenty selected articles",
      () =>
        parseCreateEpisodeJobRequest({
          idempotencyKey: "key",
          trigger: "manual",
          articleIds: Array.from(
            { length: 21 },
            (_, index) =>
              `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
          ),
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
