import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../contract.js"
import { makeGatewayHandlerLayer } from "../handlers.js"
import type { GatewayPorts } from "../ports.js"

/** Builds the transport-neutral HTTP boundary; the OS server stays outside. */
export const makeGatewayWebHandler = (
  ports: GatewayPorts,
  telemetry: Layer.Layer<never, never, never> = Layer.empty
) => {
  const apiLayer = HttpApiBuilder.layer(gatewayApi).pipe(
    Layer.provide(makeGatewayHandlerLayer(ports)),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(telemetry)
  )

  const runtime = HttpRouter.toWebHandler(apiLayer, { disableLogger: true })
  return {
    ...runtime,
    handler: (request: Request) => runtime.handler(request, undefined as never),
  }
}
