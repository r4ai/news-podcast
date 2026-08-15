import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ListFeedSyncJobsReplySchema,
  SyncFeedSubscriptionReplySchema,
  subjects,
} from "@news-podcast/protocols"

import { SubscriptionIdSchema } from "../../contract.js"
import { makeNatsGatewayPorts } from "../nats-gateway-ports.js"
import {
  type CapturedRequest,
  dependencies,
  encodedReply,
  fakeClient,
  sessionHeaders,
  userId,
  userSessionReply,
} from "./port-test-harness.js"

const subscriptionId = Schema.decodeUnknownSync(SubscriptionIdSchema)(
  "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
)

const syncJob = {
  jobId: "1b2c1f2b-0b19-4a9e-9f8c-8f0f0a1b2c3d",
  feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
  feedUrl: "https://feeds.example.com/news.xml",
  status: "Succeeded",
  attempt: 1,
  maxAttempts: 4,
  discovered: 3,
  archived: 2,
  failed: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  startedAt: "2026-08-12T00:00:01.000Z",
  completedAt: "2026-08-12T00:00:02.000Z",
  error: "partial failure",
} as const

const queuedJob = {
  jobId: "2c3d1f2b-0b19-4a9e-9f8c-8f0f0a1b2c3d",
  feedId: syncJob.feedId,
  feedUrl: syncJob.feedUrl,
  status: "Queued",
  attempt: 0,
  maxAttempts: 4,
  discovered: 0,
  archived: 0,
  failed: 0,
  createdAt: "2026-08-12T00:00:00.000Z",
} as const

const portsFor = (
  replyFor: (payload: Record<string, unknown>, subject: string) => unknown,
  requests: CapturedRequest[] = []
) =>
  makeNatsGatewayPorts(
    fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      requests.push(request)
      const payload = request.envelope.payload as Record<string, unknown>
      return encodedReply(
        request.envelope,
        "content-knowledge",
        request.subject === subjects.content.listFeedSyncJobs
          ? ListFeedSyncJobsReplySchema
          : SyncFeedSubscriptionReplySchema,
        replyFor(payload, request.subject)
      )
    }),
    dependencies()
  )

describe("NATS GatewayPorts feed synchronization", () => {
  it("projects listed sync jobs into a lowercase public status page", async () => {
    const requests: CapturedRequest[] = []
    const ports = portsFor(
      () => ({ _tag: "Listed", jobs: [syncJob] }),
      requests
    )

    const page = await Effect.runPromise(ports.listFeedSyncJobs(sessionHeaders))

    expect(requests).toHaveLength(1)
    expect(requests[0]!.subject).toBe(subjects.content.listFeedSyncJobs)
    expect(requests[0]!.envelope.actor).toEqual({ _tag: "User", userId })
    expect(page.page).toEqual({ hasMore: false })
    expect(page.items[0]).toEqual({
      jobId: syncJob.jobId,
      feedId: syncJob.feedId,
      feedUrl: syncJob.feedUrl,
      status: "succeeded",
      attempt: 1,
      maxAttempts: 4,
      discovered: 3,
      archived: 2,
      failed: 1,
      createdAt: syncJob.createdAt,
      startedAt: syncJob.startedAt,
      completedAt: syncJob.completedAt,
      error: syncJob.error,
    })
  })

  it("omits the optional lifecycle timestamps a queued job has not reached", async () => {
    const ports = portsFor(() => ({ _tag: "Listed", jobs: [queuedJob] }))

    const page = await Effect.runPromise(ports.listFeedSyncJobs(sessionHeaders))

    expect(page.items[0]!.status).toBe("queued")
    expect(page.items[0]).not.toHaveProperty("startedAt")
    expect(page.items[0]).not.toHaveProperty("completedAt")
    expect(page.items[0]).not.toHaveProperty("error")
  })

  it.each([
    ["UNAUTHENTICATED", 401, "authentication_required"],
    ["STORAGE_FAILURE", 503, "upstream_unavailable"],
  ] as const)(
    "maps a %s listing rejection to HTTP %i",
    async (code, status, problemCode) => {
      const ports = portsFor(() => ({ _tag: "Rejected", code }))

      const failure = await Effect.runPromise(
        Effect.flip(ports.listFeedSyncJobs(sessionHeaders))
      )

      expect(failure).toMatchObject({ status, code: problemCode })
    }
  )

  it("projects a triggered synchronization into the public job view", async () => {
    const requests: CapturedRequest[] = []
    const ports = portsFor(() => ({ _tag: "Synced", job: syncJob }), requests)

    const job = await Effect.runPromise(
      ports.syncFeedSubscription({ headers: sessionHeaders, subscriptionId })
    )

    expect(requests[0]!.subject).toBe(subjects.content.syncSubscription)
    expect(requests[0]!.envelope.payload).toEqual({ subscriptionId })
    expect(job.status).toBe("succeeded")
    expect(job.jobId).toBe(syncJob.jobId)
  })

  it.each([
    [{ _tag: "NotFound" }, 404, "feed_subscription_not_found"],
    [
      { _tag: "Rejected", code: "NOT_FOUND" },
      404,
      "feed_subscription_not_found",
    ],
    [
      { _tag: "Rejected", code: "UNAUTHENTICATED" },
      401,
      "authentication_required",
    ],
    [
      { _tag: "Rejected", code: "INVALID_REQUEST" },
      400,
      "invalid_subscription_request",
    ],
    [
      { _tag: "Rejected", code: "STORAGE_FAILURE" },
      503,
      "upstream_unavailable",
    ],
  ] as const)(
    "maps the %o synchronization reply to HTTP %i",
    async (reply, status, problemCode) => {
      const ports = portsFor(() => reply)

      const failure = await Effect.runPromise(
        Effect.flip(
          ports.syncFeedSubscription({
            headers: sessionHeaders,
            subscriptionId,
          })
        )
      )

      expect(failure).toMatchObject({ status, code: problemCode })
    }
  )
})
