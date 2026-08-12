import { serve } from "@hono/node-server"

import type { UnsafeGatewayHttpServer } from "../../runtime/node.js"

export const listenNodeHttpUnsafe = async (input: {
  readonly hostname: string
  readonly port: number
  readonly handler: (request: Request) => Promise<Response>
}): Promise<UnsafeGatewayHttpServer> => {
  const server = serve({
    fetch: input.handler,
    hostname: input.hostname,
    port: input.port,
  })

  return Object.freeze({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  })
}
