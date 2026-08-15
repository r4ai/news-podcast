import { Schema } from "effect"

import { SessionHeadersSchema } from "../../contract.js"
import type { UnsafeNatsRequestClient } from "../../infrastructure/unsafe/nats-request.js"

/**
 * NATS越しのGatewayPortsを検証するための共有テストハーネス。
 * 実装分割の前後で同じ観測点を使い続けられるよう、テストから切り出している。
 */

export const incomingTraceparent =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
export const userId = "d25da30b-4cd1-4875-94c7-6d48f32b5b1c"
export const ids = [
  "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  "3c4d046c-b47b-4047-a562-66ac7e74e995",
  "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  "6518412b-ce2f-4641-9f2c-a02dd515bc31",
] as const

export type CapturedRequest = Readonly<{
  subject: string
  timeoutMillis: number
  envelope: Record<string, unknown>
}>

export const encodedReply = async (
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

export const fakeClient = (
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

export const dependencies = () => {
  let index = 0
  return {
    nextMessageId: () => ids[index++ % ids.length]!,
    now: () => "2026-08-12T00:00:00.000Z",
  }
}

export const sessionHeaders = Schema.decodeUnknownSync(SessionHeadersSchema)({
  authorization: "Bearer opaque",
  cookie: "session=opaque",
  traceparent: incomingTraceparent,
})

export const userSessionReply = (request: CapturedRequest) =>
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
