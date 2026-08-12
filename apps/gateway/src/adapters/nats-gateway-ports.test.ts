import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AddFeedSubscriptionReplySchema,
  CreateAudioAccessReplySchema,
  DeleteFeedSubscriptionReplySchema,
  ListFeedSubscriptionsReplySchema,
  ListEpisodesReplySchema,
  subjects,
} from "@news-podcast/protocols"

import {
  AudioAccessSchema,
  AddFeedSubscriptionRequestSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  SessionHeadersSchema,
  SubscriptionIdSchema,
} from "../contract.js"
import type { UnsafeNatsRequestClient } from "../infrastructure/unsafe/nats-request.js"
import {
  acquireNatsGatewayPorts,
  makeNatsGatewayPorts,
} from "./nats-gateway-ports.js"

const incomingTraceparent =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
const userId = "d25da30b-4cd1-4875-94c7-6d48f32b5b1c"
const episodeId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"
const ids = [
  "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  "3c4d046c-b47b-4047-a562-66ac7e74e995",
  "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  "6518412b-ce2f-4641-9f2c-a02dd515bc31",
] as const

type CapturedRequest = Readonly<{
  subject: string
  timeoutMillis: number
  envelope: Record<string, unknown>
}>

const encodedReply = async (
  request: Record<string, unknown>,
  producer: string,
  _payloadSchema: Schema.Top,
  payload: unknown
): Promise<Uint8Array> => {
  const encoded = {
    messageId: "6518412b-ce2f-4641-9f2c-a02dd515bc31",
    correlationId: request.correlationId,
    causationId: request.messageId,
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer,
    traceparent: request.traceparent,
    actor: { _tag: "Service", service: producer },
    payload,
  }
  return new TextEncoder().encode(JSON.stringify(encoded))
}

const fakeClient = (
  responder: (request: CapturedRequest) => Promise<Uint8Array>
): UnsafeNatsRequestClient => ({
  request: async (subject, data, timeoutMillis) =>
    responder({
      subject,
      timeoutMillis,
      envelope: JSON.parse(new TextDecoder().decode(data)) as Record<
        string,
        unknown
      >,
    }),
  drain: async () => undefined,
})

const dependencies = () => {
  let index = 0
  return {
    nextMessageId: () => ids[index++ % ids.length]!,
    now: () => "2026-08-12T00:00:00.000Z",
  }
}

const sessionHeaders = Schema.decodeUnknownSync(SessionHeadersSchema)({
  authorization: "Bearer opaque",
  cookie: "session=opaque",
  traceparent: incomingTraceparent,
})

const userSessionReply = (request: CapturedRequest) =>
  encodedReply(
    request.envelope,
    "identity-access",
    Schema.Struct({
      actor: Schema.Struct({
        _tag: Schema.Literal("User"),
        userId: Schema.String,
      }),
    }),
    {
      actor: { _tag: "User", userId },
    }
  )

describe("NATS GatewayPorts adapter", () => {
  it("resolves the HTTP session through a correlated versioned NATS envelope", async () => {
    const requests: CapturedRequest[] = []
    const client = fakeClient(async (request) => {
      requests.push(request)
      return userSessionReply(request)
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const session = await Effect.runPromise(
      ports.resolveSession(sessionHeaders)
    )

    expect(session).toEqual({
      authenticated: true,
      userId,
      loginMethods: { development: false, google: true },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      subject: subjects.identity.resolveSession,
      timeoutMillis: 2_000,
      envelope: {
        actor: { _tag: "Anonymous" },
        producer: "gateway",
        correlationId: ids[0],
        causationId: ids[0],
        payload: {
          headers: [
            { name: "authorization", value: "Bearer opaque" },
            { name: "cookie", value: "session=opaque" },
          ],
        },
      },
    })
    expect(String(requests[0]?.envelope.traceparent)).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[\da-f]{16}-01$/
    )
  })

  it("composes actor resolution before each authenticated context RPC", async () => {
    const requests: CapturedRequest[] = []
    const client = fakeClient(async (request) => {
      requests.push(request)
      if (request.subject === subjects.identity.resolveSession) {
        return userSessionReply(request)
      }
      if (request.subject === subjects.production.createJob) {
        return new TextEncoder().encode(
          JSON.stringify({
            protocolVersion: "production.create-job.reply.v1",
            _tag: "Accepted",
            correlationId: request.envelope.correlationId,
            jobId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
            state: "Queued",
          })
        )
      }
      if (request.subject === "library.list-episodes.v1") {
        return encodedReply(
          request.envelope,
          "episode-library",
          ListEpisodesReplySchema,
          { _tag: "Listed", page: { items: [], page: { hasMore: false } } }
        )
      }
      return encodedReply(
        request.envelope,
        "episode-library",
        CreateAudioAccessReplySchema,
        {
          _tag: "Found",
          access: {
            url: "https://audio.example.test/episode.wav?token=opaque",
            expiresAt: "2026-08-12T00:05:00.000Z",
          },
        }
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const receipt = await Effect.runPromise(
      ports.createEpisodeJob({
        headers: Schema.decodeUnknownSync(CreateEpisodeJobHeadersSchema)({
          ...sessionHeaders,
          "idempotency-key": "daily-2026-08-12",
        }),
        payload: Schema.decodeUnknownSync(CreateEpisodeJobRequestSchema)({
          trigger: "manual",
          articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
        }),
      })
    )
    const page = await Effect.runPromise(ports.listEpisodes(sessionHeaders))
    const access = await Effect.runPromise(
      ports.createAudioAccess({
        headers: sessionHeaders,
        episodeId: Schema.decodeUnknownSync(EpisodeIdSchema)(episodeId),
      })
    )

    expect(receipt.status).toBe("queued")
    expect(page.items).toEqual([])
    expect(Schema.decodeUnknownSync(AudioAccessSchema)(access).expiresAt).toBe(
      "2026-08-12T00:05:00.000Z"
    )
    const downstream = requests.filter(
      ({ subject }) => subject !== subjects.identity.resolveSession
    )
    expect(downstream.map(({ subject }) => subject)).toEqual([
      subjects.production.createJob,
      subjects.library.listEpisodes,
      subjects.library.createAudioAccess,
    ])
    for (const request of downstream) {
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      const priorIdentityRequest = requests[requests.indexOf(request) - 1]!
      expect(request.envelope.correlationId).toBe(
        priorIdentityRequest.envelope.correlationId
      )
      expect(request.envelope.causationId).toBe(
        priorIdentityRequest.envelope.messageId
      )
    }
    expect(downstream[0]?.envelope.payload).toMatchObject({
      idempotencyKey: "daily-2026-08-12",
      trigger: "manual",
      articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
    })
  })

  it("stops before the domain RPC when the resolved actor is anonymous", async () => {
    const request = vi.fn(async (captured: CapturedRequest) =>
      encodedReply(
        captured.envelope,
        "identity-access",
        Schema.Struct({
          actor: Schema.Struct({ _tag: Schema.Literal("Anonymous") }),
        }),
        { actor: { _tag: "Anonymous" } }
      )
    )
    const ports = makeNatsGatewayPorts(fakeClient(request), dependencies())

    const problem = await Effect.runPromise(
      ports.listEpisodes(sessionHeaders).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({
      status: 401,
      code: "authentication_required",
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it("maps owner-scoped subscription commands through correlated content RPCs", async () => {
    const requests: CapturedRequest[] = []
    const subscription = {
      subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      feedUrl: "https://feeds.example.com/news.xml",
      createdAt: "2026-08-12T00:00:00.000Z",
    }
    const client = fakeClient(async (request) => {
      requests.push(request)
      if (request.subject === subjects.identity.resolveSession) {
        return userSessionReply(request)
      }
      if (request.subject === subjects.content.addSubscription) {
        return encodedReply(
          request.envelope,
          "content-knowledge",
          AddFeedSubscriptionReplySchema,
          {
            _tag: "Added",
            subscription,
          }
        )
      }
      if (request.subject === subjects.content.listSubscriptions) {
        return encodedReply(
          request.envelope,
          "content-knowledge",
          ListFeedSubscriptionsReplySchema,
          {
            _tag: "Listed",
            subscriptions: [subscription],
          }
        )
      }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        DeleteFeedSubscriptionReplySchema,
        {
          _tag: "Deleted",
        }
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    await expect(
      Effect.runPromise(
        ports.addFeedSubscription({
          headers: sessionHeaders,
          payload: Schema.decodeUnknownSync(AddFeedSubscriptionRequestSchema)({
            feedUrl: subscription.feedUrl,
          }),
        })
      )
    ).resolves.toEqual(subscription)
    await expect(
      Effect.runPromise(ports.listFeedSubscriptions(sessionHeaders))
    ).resolves.toEqual({ items: [subscription], page: { hasMore: false } })
    await expect(
      Effect.runPromise(
        ports.deleteFeedSubscription({
          headers: sessionHeaders,
          subscriptionId: Schema.decodeUnknownSync(SubscriptionIdSchema)(
            subscription.subscriptionId
          ),
        })
      )
    ).resolves.toBeUndefined()

    expect(
      requests
        .filter(({ subject }) => subject !== subjects.identity.resolveSession)
        .map(({ subject, envelope }) => ({
          subject,
          payload: envelope.payload,
        }))
    ).toEqual([
      {
        subject: subjects.content.addSubscription,
        payload: { feedUrl: subscription.feedUrl },
      },
      { subject: subjects.content.listSubscriptions, payload: {} },
      {
        subject: subjects.content.deleteSubscription,
        payload: { subscriptionId: subscription.subscriptionId },
      },
    ])
  })

  it("maps content not-found and malformed replies without leaking boundary data", async () => {
    const subscriptionId = Schema.decodeUnknownSync(SubscriptionIdSchema)(
      "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    )
    const request = vi.fn(async (subject: string, data: Uint8Array) => {
      const envelope = JSON.parse(new TextDecoder().decode(data)) as Record<
        string,
        unknown
      >
      const captured = { subject, timeoutMillis: 2_000, envelope }
      if (subject === subjects.identity.resolveSession)
        return userSessionReply(captured)
      return encodedReply(
        envelope,
        "content-knowledge",
        DeleteFeedSubscriptionReplySchema,
        { _tag: "NotFound" }
      )
    })
    const ports = makeNatsGatewayPorts(
      { request, drain: async () => undefined },
      dependencies()
    )

    const notFoundProblem = await Effect.runPromise(
      ports
        .deleteFeedSubscription({ headers: sessionHeaders, subscriptionId })
        .pipe(Effect.flip)
    )

    expect(notFoundProblem).toMatchObject({
      status: 404,
      code: "feed_subscription_not_found",
    })
  })

  it.each([
    ["NATS timeout", async () => Promise.reject(new Error("TIMEOUT"))],
    ["invalid JSON", async () => new TextEncoder().encode("not-json")],
  ])("maps %s to the existing unavailable Problem", async (_case, request) => {
    const ports = makeNatsGatewayPorts(
      { request, drain: async () => undefined },
      dependencies()
    )

    const problem = await Effect.runPromise(
      ports.resolveSession(sessionHeaders).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({ status: 503, code: "upstream_unavailable" })
  })

  it("rejects a well-formed response from a different correlation chain", async () => {
    const client = fakeClient((request) =>
      encodedReply(
        { ...request.envelope, correlationId: ids[4] },
        "identity-access",
        Schema.Struct({
          actor: Schema.Struct({ _tag: Schema.Literal("Anonymous") }),
        }),
        { actor: { _tag: "Anonymous" } }
      )
    )
    const ports = makeNatsGatewayPorts(client, dependencies())

    const problem = await Effect.runPromise(
      ports.resolveSession(sessionHeaders).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({ status: 503, code: "upstream_unavailable" })
  })

  it("acquires and drains the NATS connection within an Effect scope", async () => {
    const drain = vi.fn(async () => undefined)
    const client = {
      ...fakeClient(async () => new Uint8Array()),
      drain,
    }
    const connect = vi.fn(async () => client)

    await Effect.runPromise(
      Effect.scoped(
        acquireNatsGatewayPorts(
          {
            natsServers: ["nats://127.0.0.1:4222"],
            requestTimeoutMillis: 2_000,
            loginMethods: { development: false, google: true },
          },
          { ...dependencies(), connect }
        ).pipe(Effect.asVoid)
      )
    )

    expect(connect).toHaveBeenCalledWith(["nats://127.0.0.1:4222"])
    expect(drain).toHaveBeenCalledOnce()
  })
})
