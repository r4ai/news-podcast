import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../contract.js"
import { makeGatewayHandlerLayer } from "../handlers.js"
import type { GatewayPorts } from "../ports.js"

/** Builds the transport-neutral HTTP boundary; the OS server stays outside. */
export const makeGatewayWebHandler = (ports: GatewayPorts) => {
  const apiLayer = HttpApiBuilder.layer(gatewayApi).pipe(
    Layer.provide(makeGatewayHandlerLayer(ports)),
    Layer.provide(HttpServer.layerServices)
  )

  return HttpRouter.toWebHandler(apiLayer, { disableLogger: true })
}
