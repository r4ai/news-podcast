import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"

export type UnsafeNatsRequestClient = DeepReadonly<{
  readonly request: (
    subject: string,
    payload: Uint8Array,
    timeoutMillis: number
  ) => Promise<Uint8Array>
  readonly drain: () => Promise<void>
}>

/** The rejecting NATS SDK surface is kept out of the functional adapter. */
export const connectNatsRequestClientUnsafe = async (
  servers: readonly string[]
): Promise<UnsafeNatsRequestClient> => {
  const connection = await connect({ servers: [...servers] })

  return deepFreeze({
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
    drain: () => connection.drain(),
  })
}
