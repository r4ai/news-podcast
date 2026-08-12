import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseCreateAudioAccessRequest,
  parseCreateAudioAccessReply,
  parseListEpisodesReply,
  parseListEpisodesRequest,
} from "./episode-library-rpc.js"

const episodeId = "8a76daf6-d3d7-47db-9644-228dc5328c84"

describe("episode-library RPC contracts", () => {
  it("parses and freezes list and audio request/reply states", async () => {
    const [listRequest, audioRequest, listed, found, notFound, rejected] =
      await Effect.runPromise(
        Effect.all([
          parseListEpisodesRequest({}),
          parseCreateAudioAccessRequest({ episodeId }),
          parseListEpisodesReply({
            _tag: "Listed",
            page: {
              items: [
                {
                  id: episodeId,
                  title: "Daily news",
                  script: "Immutable script",
                  createdAt: "2026-08-12T00:00:00.000Z",
                  sources: [
                    {
                      sourceKind: "rss",
                      url: "https://example.com/news/1",
                      title: "News 1",
                      snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
                    },
                  ],
                },
              ],
              page: { hasMore: false },
            },
          }),
          parseCreateAudioAccessReply({
            _tag: "Found",
            access: {
              url: "https://audio.example.test/private.wav?signature=opaque",
              expiresAt: "2026-08-12T00:05:00.000Z",
            },
          }),
          parseCreateAudioAccessReply({ _tag: "NotFound" }),
          parseListEpisodesReply({
            _tag: "Rejected",
            code: "STORAGE_FAILURE",
          }),
        ])
      )

    expect(listRequest).toEqual({})
    expect(audioRequest).toEqual({ episodeId })
    expect(listed._tag).toBe("Listed")
    expect(found._tag).toBe("Found")
    expect(notFound).toEqual({ _tag: "NotFound" })
    expect(rejected).toEqual({
      _tag: "Rejected",
      code: "STORAGE_FAILURE",
    })
    if (listed._tag !== "Listed") throw new Error("Expected Listed reply")
    expect(Object.isFrozen(listed.page.items[0]?.sources[0])).toBe(true)
  })

  const invalidCases: ReadonlyArray<
    readonly [string, () => Effect.Effect<unknown, unknown>]
  > = [
    ["list request excess field", () => parseListEpisodesRequest({ ownerId: "forged" })],
    ["malformed episode ID", () => parseCreateAudioAccessRequest({ episodeId: "episode-1" })],
    [
      "RSS source without snapshot",
      () =>
        parseListEpisodesReply({
          _tag: "Listed",
          page: {
            items: [
              {
                id: episodeId,
                title: "Daily news",
                script: "Script",
                createdAt: "2026-08-12T00:00:00.000Z",
                sources: [
                  {
                    sourceKind: "rss",
                    url: "https://example.com/news/1",
                    title: "News 1",
                  },
                ],
              },
            ],
            page: { hasMore: false },
          },
        }),
    ],
    [
      "unknown rejection code",
      () =>
        parseCreateAudioAccessReply({
          _tag: "Rejected",
          code: "DATABASE_EXPLODED",
        }),
    ],
  ]

  it.each(invalidCases)("rejects %s", async (_case, parseInvalid) => {
    const exit = await Effect.runPromiseExit(parseInvalid())
    expect(exit._tag).toBe("Failure")
  })
})
