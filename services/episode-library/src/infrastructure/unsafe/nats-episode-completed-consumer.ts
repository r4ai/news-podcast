import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  jetstream,
} from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"

export type UnsafeEpisodeCompletedDelivery = DeepReadonly<{
  readonly data: Uint8Array
  readonly deliveryCount: number
  readonly ack: () => Promise<void>
  readonly nack: (delayMillis: number) => Promise<void>
}>

export type UnsafeEpisodeCompletedConsumer = DeepReadonly<{
  readonly receive: () => Promise<UnsafeEpisodeCompletedDelivery | undefined>
  readonly drain: () => Promise<void>
}>

export type UnsafeEpisodeCompletedConsumerConfig = DeepReadonly<{
  readonly servers: readonly string[]
  readonly stream: string
  readonly durableName: string
  readonly ackWaitMillis: number
  readonly maximumDeliveries: number
}>

/** All mutable JetStream iterator and acknowledgement operations stay here. */
export const connectEpisodeCompletedConsumerUnsafe = async (
  config: UnsafeEpisodeCompletedConsumerConfig
): Promise<UnsafeEpisodeCompletedConsumer> => {
  const connection = await connect({ servers: [...config.servers] })
  try {
    const client = jetstream(connection)
    const manager = await client.jetstreamManager()
    await manager.consumers.add(config.stream, {
      name: config.durableName,
      durable_name: config.durableName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subject: subjects.production.jobCompletedV2,
      ack_wait: config.ackWaitMillis * 1_000_000,
      max_deliver: config.maximumDeliveries,
      max_ack_pending: 1,
    })
    const consumer = await client.consumers.get(
      config.stream,
      config.durableName
    )
    const messages = await consumer.consume({
      max_messages: 1,
      abort_on_missing_resource: true,
    })
    const iterator = messages[Symbol.asyncIterator]()
    let drained = false

    return deepFreeze({
      receive: async () => {
        const next = await iterator.next()
        if (next.done) return undefined
        const message = next.value
        return Object.freeze({
          data: message.data,
          deliveryCount: message.info.deliveryCount,
          ack: async () => void message.ack(),
          nack: async (delayMillis: number) => void message.nak(delayMillis),
        })
      },
      drain: async () => {
        if (drained) return
        drained = true
        let timeout: ReturnType<typeof setTimeout> | undefined
        const messagesClosed = await Promise.race([
          messages.close().then(() => true),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 1_000)
          }),
        ])
        if (timeout !== undefined) clearTimeout(timeout)
        if (!messagesClosed) {
          await connection.close()
          return
        }
        const drainedGracefully = await Promise.race([
          connection.drain().then(() => true),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 1_000)
          }),
        ])
        if (timeout !== undefined) clearTimeout(timeout)
        if (!drainedGracefully) await connection.close()
      },
    })
  } catch (cause) {
    await connection.close().catch(() => undefined)
    throw cause
  }
}
