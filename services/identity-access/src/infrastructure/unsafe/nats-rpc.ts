import { connect } from "@nats-io/transport-node"

export type UnsafeNatsRpcDelivery = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Promise<void>
}>

export type UnsafeNatsRpcServer = Readonly<{
  readonly receive: () => Promise<UnsafeNatsRpcDelivery | undefined>
  readonly drain: () => Promise<void>
}>

/** Mutable subscription and async-iterator state stays at the runtime edge. */
export const connectNatsRpcUnsafe = async (
  servers: readonly string[],
  subject: string,
  queueGroup: string
): Promise<UnsafeNatsRpcServer> => {
  const connection = await connect({ servers: [...servers] })
  try {
    const subscription = connection.subscribe(subject, { queue: queueGroup })
    const iterator = subscription[Symbol.asyncIterator]()
    const decoder = new TextDecoder()

    return Object.freeze({
      receive: async (): Promise<UnsafeNatsRpcDelivery | undefined> => {
        const next = await iterator.next()
        if (next.done) return undefined
        const message = next.value
        return Object.freeze({
          payload: decoder.decode(message.data),
          reply: async (payload: string) => {
            if (!message.respond(payload)) {
              throw new Error("NATS request has no reply subject")
            }
          },
        })
      },
      drain: () => connection.drain(),
    })
  } catch (error) {
    await connection.drain().catch(() => undefined)
    throw error
  }
}
