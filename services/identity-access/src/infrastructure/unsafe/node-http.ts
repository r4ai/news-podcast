import { serve } from "@hono/node-server"

export const listenIdentityHttpUnsafe = async (input: {
  readonly hostname: string
  readonly port: number
  readonly handler: (request: Request) => Promise<Response>
}) => {
  const server = serve({
    fetch: input.handler,
    hostname: input.hostname,
    port: input.port,
  })
  return Object.freeze({
    close: () =>
      new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done()))
      ),
  })
}
