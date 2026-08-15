import { connectNatsRpc } from "@news-podcast/nats-runtime"

export type UnsafeNatsRpcDelivery = Readonly<{
  subject?: string
  payload: string
  reply: (payload: string) => Promise<void>
}>
export type UnsafeNatsRpcServer = Readonly<{
  receive: () => Promise<UnsafeNatsRpcDelivery | undefined>
  drain: () => Promise<void>
}>

export const connectNatsRpcUnsafe = (
  servers: readonly string[],
  subject: string | readonly string[],
  queueGroup: string
): Promise<UnsafeNatsRpcServer> => connectNatsRpc(servers, subject, queueGroup)
