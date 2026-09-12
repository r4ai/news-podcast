import { serve } from "@hono/node-server"

import type { GatewayRequestHandler } from "../../runtime/telemetry-proxy.js"

import type { UnsafeGatewayHttpServer } from "../../runtime/node.js"

export const listenNodeHttpUnsafe = async (input: {
  readonly hostname: string
  readonly port: number
  readonly handler: GatewayRequestHandler
}): Promise<UnsafeGatewayHttpServer> => {
  const server = serve({
    fetch: (request, bindings) =>
      input.handler(request, bindings.incoming.socket.remoteAddress),
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
