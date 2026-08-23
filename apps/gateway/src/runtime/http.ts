import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../contract.js"
import { makeGatewayHandlerLayer } from "../application/handlers/index.js"
import type { GatewayPorts } from "../application/ports.js"
import { routeApiDocs } from "./api-docs.js"

/** Builds the transport-neutral HTTP boundary; the OS server stays outside. */
export const makeGatewayWebHandler = (
  ports: GatewayPorts,
  telemetry: Layer.Layer<never, never, never> = Layer.empty,
  options: {
    readonly fetcher?: typeof globalThis.fetch
  } = {}
) => {
  const apiLayer = HttpApiBuilder.layer(gatewayApi).pipe(
    Layer.provide(makeGatewayHandlerLayer(ports, options)),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(telemetry)
  )

  const runtime = HttpRouter.toWebHandler(apiLayer, { disableLogger: true })
  return {
    ...runtime,
    handler: (request: Request) =>
      Promise.resolve(
        routeApiDocs(request) ?? runtime.handler(request, undefined as never)
      ),
  }
}
