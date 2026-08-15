import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  ActorSchema,
  MessageEnvelopeSchema,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { SessionHeadersSchema } from "../../contract.js"
import type { UnsafeNatsRequestClient } from "../../infrastructure/unsafe/nats-request.js"
import { unauthorized, unavailable } from "./problems.js"

/**
 * NATS上の相関付きRPCと、その前段のセッション解決をひとまとめにした搬送層。
 * 各ポート群はここが保証する「認証済みアクターと親子系譜」だけを前提にする。
 */

export type Actor = Schema.Schema.Type<typeof ActorSchema>
export type SessionHeaders = Schema.Schema.Type<typeof SessionHeadersSchema>

export type Dependencies = Readonly<{
  nextMessageId: () => string
  now: () => string
}>

export type RequestLineage = Readonly<{
  messageId: string
  correlationId: string
  causationId: string
  remoteTraceparent: string | undefined
}>

export type AdapterOptions = Readonly<{
  requestTimeoutMillis: number
  loginMethods: { readonly development: boolean; readonly google: boolean }
}>

const SessionReplySchema = Schema.Struct({ actor: ActorSchema })

export const decodeJson = (data: Uint8Array) =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(data)),
    catch: unavailable,
  })

export type Transport = ReturnType<typeof makeTransport>

export const makeTransport = (
  client: UnsafeNatsRequestClient,
  dependencies: Dependencies,
  options: AdapterOptions
) => {
  const send = (
    subject: string,
    actor: Actor,
    payload: unknown,
    lineage: RequestLineage
  ) => {
    const operation = Effect.currentSpan.pipe(
      Effect.flatMap((span) =>
        parse(MessageEnvelopeSchema)({
          messageId: lineage.messageId,
          correlationId: lineage.correlationId,
          causationId: lineage.causationId,
          occurredAt: dependencies.now(),
          producer: "gateway",
          traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
          actor,
          payload,
        })
      ),
      Effect.flatMap((envelope) =>
        Schema.encodeEffect(MessageEnvelopeSchema)(envelope)
      ),
      Effect.map((encoded) =>
        new TextEncoder().encode(JSON.stringify(encoded))
      ),
      Effect.flatMap((encoded) =>
        Effect.tryPromise({
          try: () =>
            client.request(subject, encoded, options.requestTimeoutMillis),
          catch: unavailable,
        })
      ),
      Effect.mapError(unavailable)
    )
    const traced = withMessagingSpan(operation, subject, "publish")
    return lineage.remoteTraceparent === undefined
      ? traced
      : withRemoteTraceparent(traced, lineage.remoteTraceparent)
  }

  const receive = (
    data: Uint8Array,
    subject: string,
    expectedProducer: string,
    lineage: RequestLineage
  ) =>
    decodeJson(data).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.flatMap((reply) => {
        const verify = Effect.filterOrFail(
          Effect.succeed(reply),
          (candidate) =>
            candidate.producer === expectedProducer &&
            candidate.correlationId === lineage.correlationId &&
            candidate.causationId === lineage.messageId,
          unavailable
        )
        return withRemoteTraceparent(
          withMessagingSpan(verify, subject, "receive"),
          reply.traceparent
        )
      }),
      Effect.mapError(unavailable)
    )

  const rpc = (
    subject: string,
    expectedProducer: string,
    actor: Actor,
    payload: unknown,
    lineage: RequestLineage
  ) =>
    send(subject, actor, payload, lineage).pipe(
      Effect.flatMap((reply) =>
        receive(reply, subject, expectedProducer, lineage)
      )
    )

  const resolveActor = (headers: SessionHeaders) => {
    const messageId = dependencies.nextMessageId()
    const lineage: RequestLineage = {
      messageId,
      correlationId: messageId,
      causationId: messageId,
      remoteTraceparent: headers.traceparent,
    }
    const headerPairs = [
      ...(headers.authorization
        ? [{ name: "authorization", value: headers.authorization }]
        : []),
      ...(headers.cookie ? [{ name: "cookie", value: headers.cookie }] : []),
    ]

    return rpc(
      subjects.identity.resolveSession,
      "identity-access",
      { _tag: "Anonymous" },
      { headers: headerPairs },
      lineage
    ).pipe(
      Effect.flatMap((reply) => parse(SessionReplySchema)(reply.payload)),
      Effect.mapError(unavailable),
      Effect.map(({ actor }) => deepFreeze({ actor, lineage }))
    )
  }

  const authenticated = (headers: SessionHeaders) =>
    resolveActor(headers).pipe(
      Effect.flatMap(({ actor, lineage }) =>
        actor._tag === "User"
          ? Effect.succeed(deepFreeze({ actor, lineage }))
          : Effect.fail(unauthorized())
      )
    )

  const childLineage = (
    parent: RequestLineage,
    messageId: string
  ): RequestLineage => ({
    messageId,
    correlationId: parent.correlationId,
    causationId: parent.messageId,
    remoteTraceparent: parent.remoteTraceparent,
  })

  /**
   * 認証済みアクターで一往復のRPCを行い、応答本文だけを復号して返す。
   * 上流固有の失敗はすべて503へ畳み、未認証は401のまま透過する。
   */
  const ownerRpc = <Value>(
    headers: SessionHeaders,
    subject: string,
    producer: string,
    payload: unknown,
    decode: (value: unknown) => Effect.Effect<Value, unknown, never>
  ) =>
    authenticated(headers).pipe(
      Effect.flatMap(({ actor, lineage: parent }) => {
        const lineage = childLineage(parent, dependencies.nextMessageId())
        return rpc(subject, producer, actor, payload, lineage).pipe(
          Effect.flatMap((reply) => decode(reply.payload)),
          Effect.mapError(unavailable)
        )
      })
    )

  return deepFreeze({
    now: dependencies.now,
    nextMessageId: dependencies.nextMessageId,
    loginMethods: options.loginMethods,
    send,
    rpc,
    resolveActor,
    authenticated,
    childLineage,
    ownerRpc,
  })
}
