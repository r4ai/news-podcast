import { connect } from "@nats-io/transport-node"

import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"

export type UnsafeNatsRequestClient = DeepReadonly<{
  request: (
    subject: string,
    payload: Uint8Array,
    timeoutMillis: number,
    signal?: AbortSignal
  ) => Promise<Uint8Array>
  close: () => Promise<void>
}>

export const connectNatsRequestUnsafe = async (
  servers: readonly string[]
): Promise<UnsafeNatsRequestClient> => {
  const connection = await connect({ servers: [...servers] })
  return deepFreeze({
    request: async (subject, payload, timeoutMillis, signal) => {
      if (signal?.aborted) throw new Error("canceled")
      const request = connection.request(subject, payload, {
        timeout: timeoutMillis,
      })
      const message = signal
        ? await Promise.race([
            request,
            new Promise<never>((_, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("canceled")),
                {
                  once: true,
                }
              )
            ),
          ])
        : await request
      return new Uint8Array(message.data)
    },
    close: () => connection.drain(),
  })
}
