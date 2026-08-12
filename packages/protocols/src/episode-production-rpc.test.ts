import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseCancelEpisodeJobRequest,
  parseEpisodeJobControlReply,
  parseGetEpisodeJobRequest,
  parseListEpisodeJobsRequest,
  parseListEpisodeJobEventsRequest,
  parseRetryEpisodeJobRequest,
} from "./episode-production-rpc.js"

const jobId = "10e2d4e1-c127-479f-a124-2ea037bd9319"

describe("episode-production RPC contracts", () => {
  it("parses owner-free requests and every successful control reply", async () => {
    const [get, list, events, cancel, retry, found, listed, canceled, retried] =
      await Effect.runPromise(
        Effect.all([
          parseGetEpisodeJobRequest({ jobId }),
          parseListEpisodeJobsRequest({ limit: 25 }),
          parseListEpisodeJobEventsRequest({
            jobId,
            afterSequence: 41,
            limit: 50,
          }),
          parseCancelEpisodeJobRequest({ jobId }),
          parseRetryEpisodeJobRequest({
            jobId,
            idempotencyKey: "retry-from-home-screen",
          }),
          parseEpisodeJobControlReply({
            _tag: "Found",
            job: {
              jobId,
              status: "running",
              trigger: "manual",
              attempt: 2,
              maxAttempts: 4,
              createdAt: "2026-08-13T00:00:00.000Z",
              startedAt: "2026-08-13T00:00:00.000Z",
            },
          }),
          parseEpisodeJobControlReply({
            _tag: "Listed",
            jobs: [],
          }),
          parseEpisodeJobControlReply({
            _tag: "Canceled",
            job: {
              jobId,
              status: "canceled",
              trigger: "manual",
              attempt: 2,
              maxAttempts: 4,
              createdAt: "2026-08-13T00:00:00.000Z",
              canceledAt: "2026-08-13T00:01:00.000Z",
              reason: "requested_by_user",
            },
          }),
          parseEpisodeJobControlReply({
            _tag: "Retried",
            job: {
              jobId: "6518412b-ce2f-4641-9f2c-a02dd515bc31",
              status: "queued",
              trigger: "manual",
              attempt: 0,
              maxAttempts: 4,
              createdAt: "2026-08-13T00:02:00.000Z",
              enqueuedAt: "2026-08-13T00:02:00.000Z",
            },
          }),
        ])
      )

    expect(get).toEqual({ jobId })
    expect(list).toEqual({ limit: 25 })
    expect(events).toEqual({ jobId, afterSequence: 41, limit: 50 })
    expect(cancel).toEqual({ jobId })
    expect(retry.idempotencyKey).toBe("retry-from-home-screen")
    expect([found._tag, listed._tag, canceled._tag, retried._tag]).toEqual([
      "Found",
      "Listed",
      "Canceled",
      "Retried",
    ])
    expect(Object.isFrozen(canceled)).toBe(true)
  })

  it.each([
    [
      "forged owner",
      () => parseGetEpisodeJobRequest({ jobId, ownerId: "victim" }),
    ],
    ["invalid job ID", () => parseCancelEpisodeJobRequest({ jobId: "job-1" })],
    ["unbounded list", () => parseListEpisodeJobsRequest({ limit: 101 })],
    [
      "negative event cursor",
      () => parseListEpisodeJobEventsRequest({ jobId, afterSequence: -1 }),
    ],
    [
      "missing retry idempotency key",
      () => parseRetryEpisodeJobRequest({ jobId }),
    ],
    [
      "leaked owner in reply",
      () =>
        parseEpisodeJobControlReply({
          _tag: "Found",
          job: {
            jobId,
            ownerId: "victim",
            status: "queued",
            trigger: "manual",
            attempt: 0,
            maxAttempts: 4,
            createdAt: "2026-08-13T00:00:00.000Z",
            enqueuedAt: "2026-08-13T00:00:00.000Z",
          },
        }),
    ],
  ])("rejects %s", async (_name, parseInvalid) => {
    const exit = await Effect.runPromiseExit(
      parseInvalid() as Effect.Effect<unknown, unknown>
    )
    expect(exit._tag).toBe("Failure")
  })
})
