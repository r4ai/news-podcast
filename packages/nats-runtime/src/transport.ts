import { connect } from "@nats-io/transport-node"

import { drainNatsConnection } from "./drain.js"
import { createTerminalDeliveryQueue } from "./terminal-delivery-queue.js"

export type NatsRpcDelivery = Readonly<{
  subject: string
  payload: string
  reply: (payload: string) => Promise<void>
}>

export type NatsRpcServer = Readonly<{
  receive: () => Promise<NatsRpcDelivery | undefined>
  drain: () => Promise<void>
}>

export class NatsSubscriptionEndedError extends Error {
  override readonly name = "NatsSubscriptionEndedError"
  constructor(readonly subject: string) {
    super(`NATS subscription ended: ${subject}`)
  }
}

export class NatsConnectionDisconnectedError extends Error {
  override readonly name = "NatsConnectionDisconnectedError"
  constructor(readonly server: string) {
    super(`NATS connection disconnected: ${server}`)
  }
}

/** Owns one connection and immediately surfaces the first terminal subscription. */
export const connectNatsRpc = async (
  servers: readonly string[],
  inputSubjects: string | readonly string[],
  queueGroup: string
): Promise<NatsRpcServer> => {
  const connection = await connect({ servers: [...servers], reconnect: false })
  const subjects =
    typeof inputSubjects === "string" ? [inputSubjects] : [...inputSubjects]
  const queue = createTerminalDeliveryQueue<NatsRpcDelivery>()
  const decoder = new TextDecoder()

  try {
    for (const subject of subjects) {
      const subscription = connection.subscribe(subject, { queue: queueGroup })
      void (async () => {
        try {
          for await (const message of subscription) {
            await queue.offer(
              Object.freeze({
                subject: message.subject,
                payload: decoder.decode(message.data),
                reply: async (payload: string) => {
                  if (!message.respond(payload)) {
                    throw new Error("NATS request has no reply subject")
                  }
                },
              })
            )
          }
          queue.terminate(new NatsSubscriptionEndedError(subject))
        } catch (failure) {
          queue.terminate(failure)
        }
      })()
    }
    void connection
      .closed()
      .then((failure) =>
        queue.terminate(
          failure ?? new Error("NATS connection closed without a reason")
        )
      )
    void (async () => {
      try {
        for await (const status of connection.status()) {
          if (status.type !== "disconnect") continue
          queue.terminate(new NatsConnectionDisconnectedError(status.server))
          return
        }
      } catch (failure) {
        queue.terminate(failure)
      }
    })()
    return Object.freeze({
      receive: queue.receive,
      drain: () => drainNatsConnection(connection),
    })
  } catch (failure) {
    await drainNatsConnection(connection).catch(() => undefined)
    throw failure
  }
}
