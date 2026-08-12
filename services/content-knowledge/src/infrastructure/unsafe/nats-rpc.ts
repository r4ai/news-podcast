import { connect } from "@nats-io/transport-node"

export type UnsafeNatsRpcDelivery = Readonly<{
  readonly subject: string
  readonly payload: string
  readonly reply: (payload: string) => Promise<void>
}>
export type UnsafeNatsRpcServer = Readonly<{
  readonly receive: () => Promise<UnsafeNatsRpcDelivery | undefined>
  readonly drain: () => Promise<void>
}>

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
    if (waiter !== undefined) waiter(delivery)
    else if (delivery !== undefined) deliveries.push(delivery)
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
              if (!message.respond(payload))
                throw new Error("NATS request has no reply subject")
            },
          })
        }
      } catch (error) {
        failure = error
      } finally {
        active -= 1
        if (active === 0) offer(undefined)
      }
    })()
  }
  return Object.freeze({
    receive: async () => {
      if (failure !== undefined) throw failure
      const delivery = deliveries.shift()
      if (delivery !== undefined) return delivery
      if (active === 0) return undefined
      return new Promise<UnsafeNatsRpcDelivery | undefined>((resolve) =>
        waiters.push(resolve)
      )
    },
    drain: () => connection.drain(),
  })
}
