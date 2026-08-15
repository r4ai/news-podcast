import { jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { drainNatsConnection } from "@news-podcast/nats-runtime"

export type UnsafeProductionJetStream = DeepReadonly<{
  publish: (
    subject: string,
    payload: string,
    messageId: string
  ) => Promise<{ readonly duplicate: boolean }>
  close: () => Promise<void>
}>

/** Mutable NATS SDK state is owned and released only at this boundary. */
export const connectProductionJetStreamUnsafe = async (
  servers: readonly string[]
): Promise<UnsafeProductionJetStream> => {
  const connection = await connect({ servers: [...servers] })
  const client = jetstream(connection)
  const encoder = new TextEncoder()
  return deepFreeze({
    publish: async (subject, payload, messageId) => {
      const acknowledgement = await client.publish(
        subject,
        encoder.encode(payload),
        { msgID: messageId }
      )
      return deepFreeze({ duplicate: acknowledgement.duplicate })
    },
    close: () => drainNatsConnection(connection),
  })
}
