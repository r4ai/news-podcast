import { jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"

export type UnsafeJetStream = DeepReadonly<{
  readonly publish: (
    subject: string,
    payload: string,
    messageId: string
  ) => Promise<
    DeepReadonly<{
      readonly stream: string
      readonly sequence: number
      readonly duplicate: boolean
    }>
  >
  readonly close: () => Promise<void>
}>

/** Rejecting NATS SDK promises are isolated here and converted to Effect by callers. */
export const connectJetStreamUnsafe = async (
  servers: readonly string[]
): Promise<UnsafeJetStream> => {
  const connection = await connect({ servers: [...servers] })
  const client = jetstream(connection)
  const encoder = new TextEncoder()

  const publish = async (
    subject: string,
    payload: string,
    messageId: string
  ) => {
    const acknowledgement = await client.publish(
      subject,
      encoder.encode(payload),
      {
        msgID: messageId,
      }
    )
    return deepFreeze({
      stream: acknowledgement.stream,
      sequence: acknowledgement.seq,
      duplicate: acknowledgement.duplicate,
    })
  }
  const close = (): Promise<void> => connection.drain()

  return deepFreeze({ publish, close })
}
