import { makeNatsGatewayPorts } from "@news-podcast/gateway"
import { handleCreateJobRpc } from "@news-podcast/episode-production"
import {
  MessageEnvelopeSchema,
  ResolveSessionReplySchema,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

const ids = [
  "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  "3c4d046c-b47b-4047-a562-66ac7e74e995",
  "5af55f2e-ff0b-475c-866a-f2cff48c101d",
] as const
const instant = "2026-08-12T00:00:00.000Z"

const envelopeReply = (
  request: Readonly<Record<string, unknown>>,
  producer: string,
  payload: unknown
) =>
  new TextEncoder().encode(
    JSON.stringify(
      Schema.encodeSync(MessageEnvelopeSchema)(
        Schema.decodeUnknownSync(MessageEnvelopeSchema)({
          messageId: ids[3],
          correlationId: request.correlationId,
          causationId: request.messageId,
          occurredAt: instant,
          producer,
          traceparent: request.traceparent,
          actor: { _tag: "Service", service: producer },
          payload,
        })
      )
    )
  )

const makeBroker = (
  save: (job: unknown) => Effect.Effect<unknown, unknown>
) => {
  const create = handleCreateJobRpc({
    nextJobId: Effect.succeed(ids[0] as never),
    now: Effect.succeed(instant as never),
    saveIdempotently: (job) => save(job) as never,
    replyDependencies: { newMessageId: () => ids[3], now: () => instant },
  })
  return {
    request: async (subject: string, bytes: Uint8Array) => {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >
      if (subject === subjects.identity.resolveSession) {
        const payload = Schema.decodeUnknownSync(ResolveSessionReplySchema)({
          _tag: "Resolved",
          actor: { _tag: "User", userId: "owner-1" },
        })
        return envelopeReply(request, "identity-access", payload)
      }
      let reply: string | undefined
      await Effect.runPromise(
        create({
          payload: new TextDecoder().decode(bytes),
          reply: (value) => Effect.sync(() => void (reply = value)),
        })
      )
      if (reply === undefined) throw new Error("RPC timed out")
      return new TextEncoder().encode(reply)
    },
    drain: async () => undefined,
  }
}

const dependencies = () => {
  let index = 0
  return {
    nextMessageId: () => ids[index++ % ids.length]!,
    now: () => instant,
  }
}

describe("provider-consumer RPC contracts", () => {
  it("feeds actual create-job handler bytes into the actual Gateway consumer", async () => {
    const broker = makeBroker((job) => Effect.succeed(job))
    const ports = makeNatsGatewayPorts(broker, dependencies())

    const receipt = await Effect.runPromise(
      ports.createEpisodeJob({
        headers: {
          authorization: "Bearer opaque",
          "idempotency-key": "contract-1" as never,
        },
        payload: { trigger: "manual", articleIds: [ids[1] as never] },
      })
    )

    expect(receipt).toMatchObject({ id: ids[0], status: "queued" })
  })

  it("preserves the business rejection through the same encoded boundary", async () => {
    const broker = makeBroker(() =>
      Effect.fail({ _tag: "IdempotencyConflict" } as never)
    )
    const ports = makeNatsGatewayPorts(broker, dependencies())

    const problem = await Effect.runPromise(
      ports
        .createEpisodeJob({
          headers: {
            authorization: "Bearer opaque",
            "idempotency-key": "contract-1" as never,
          },
          payload: { trigger: "manual", articleIds: [ids[1] as never] },
        })
        .pipe(Effect.flip)
    )

    expect(problem).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    })
  })

  it("keeps a complete unique registry of the 26 request/reply subjects", () => {
    const rpcSubjects = [
      ...Object.values(subjects.identity),
      ...Object.values(subjects.content).filter(
        (subject) => subject !== subjects.content.articleArchived
      ),
      ...Object.values(subjects.production).filter(
        (subject) =>
          subject !== subjects.production.jobCompleted &&
          subject !== subjects.production.jobCompletedV2
      ),
      ...Object.values(subjects.library).filter(
        (subject) => subject !== subjects.library.episodePublished
      ),
    ]
    expect(rpcSubjects).toHaveLength(26)
    expect(new Set(rpcSubjects)).toHaveLength(26)
  })
})
