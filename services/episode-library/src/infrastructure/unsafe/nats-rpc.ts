import { connect } from "@nats-io/transport-node"

export type UnsafeNatsRpcDelivery = Readonly<{
  subject: string
  payload: string
  reply: (payload: string) => Promise<void>
}>

export type UnsafeNatsRpcServer = Readonly<{
  receive: () => Promise<UnsafeNatsRpcDelivery | undefined>
  drain: () => Promise<void>
}>

/** Mutable multi-subscription queue is confined to the unsafe SDK boundary. */
export const connectNatsRpcUnsafe = async (
  servers: readonly string[],
  subjects: readonly string[],
  queueGroup: string
): Promise<UnsafeNatsRpcServer> => {
  const connection = await connect({ servers: [...servers] })
  const decoder = new TextDecoder()
  const deliveries: UnsafeNatsRpcDelivery[] = []
  const waiters: Array<(delivery: UnsafeNatsRpcDelivery | undefined) => void> =
    []
  let active = subjects.length
  let failure: unknown

  const offer = (delivery: UnsafeNatsRpcDelivery | undefined) => {
    const waiter = waiters.shift()
    if (waiter) waiter(delivery)
    else if (delivery) deliveries.push(delivery)
  }

  for (const subject of subjects) {
    const subscription = connection.subscribe(subject, { queue: queueGroup })
    void (async () => {
      try {
        for await (const message of subscription) {
          offer({
            subject: message.subject,
            payload: decoder.decode(message.data),
            reply: async (payload) => {
              if (!message.respond(payload)) {
                throw new Error("NATS request has no reply subject")
              }
            },
          })
        }
      } catch (cause) {
        failure = cause
      } finally {
        active -= 1
        if (active === 0) offer(undefined)
      }
    })()
  }

  return {
    receive: async () => {
      if (failure !== undefined) throw failure
      const delivery = deliveries.shift()
      if (delivery) return delivery
      if (active === 0) return undefined
      return new Promise((resolve) => waiters.push(resolve))
    },
    drain: () => connection.drain(),
  }
}
