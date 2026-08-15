import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { drainNatsConnection } from "@news-podcast/nats-runtime"

export type UnsafeNatsRequestClient = DeepReadonly<{
  readonly request: (
    subject: string,
    payload: Uint8Array,
    timeoutMillis: number
  ) => Promise<Uint8Array>
  readonly closed?: () => Promise<void>
  readonly drain: () => Promise<void>
}>

/** The rejecting NATS SDK surface is kept out of the functional adapter. */
export const connectNatsRequestClientUnsafe = async (
  servers: readonly string[]
): Promise<UnsafeNatsRequestClient> => {
  const connection = await connect({ servers: [...servers], reconnect: false })
  const closed = async (): Promise<void> => {
    const disconnected = (async () => {
      for await (const status of connection.status()) {
        if (status.type === "disconnect") {
          throw new Error(`NATS connection disconnected: ${status.server}`)
        }
      }
      throw new Error("NATS connection status stream ended")
    })()
    const terminal = connection.closed().then((failure) => {
      throw failure ?? new Error("NATS connection closed without a reason")
    })
    return Promise.race([disconnected, terminal])
  }

  return deepFreeze({
    closed,
    request: async (
      subject: string,
      payload: Uint8Array,
      timeoutMillis: number
    ) => {
      const reply = await connection.request(subject, payload, {
        timeout: timeoutMillis,
      })
      return new Uint8Array(reply.data)
    },
    drain: () => drainNatsConnection(connection),
  })
}
