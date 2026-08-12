import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "./contract.js"
import type { GatewayPorts } from "./ports.js"

const freezeSuccess = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>
) => effect.pipe(Effect.map(deepFreeze))

export const makeGatewayHandlers = (ports: GatewayPorts) =>
  deepFreeze({
    health: () => freezeSuccess(ports.health()),
    resolveSession: (headers: Parameters<GatewayPorts["resolveSession"]>[0]) =>
      freezeSuccess(ports.resolveSession(deepFreeze(headers))),
    createEpisodeJob: (
      input: Parameters<GatewayPorts["createEpisodeJob"]>[0]
    ) => freezeSuccess(ports.createEpisodeJob(deepFreeze(input))),
    listEpisodes: (headers: Parameters<GatewayPorts["listEpisodes"]>[0]) =>
      freezeSuccess(ports.listEpisodes(deepFreeze(headers))),
    createAudioAccess: (
      input: Parameters<GatewayPorts["createAudioAccess"]>[0]
    ) => freezeSuccess(ports.createAudioAccess(deepFreeze(input))),
  })

export const makeGatewayHandlerLayer = (ports: GatewayPorts) => {
  const handlers = makeGatewayHandlers(ports)
  return Layer.mergeAll(
    HttpApiBuilder.group(gatewayApi, "system", (group) =>
      group.handle("health", handlers.health)
    ),
    HttpApiBuilder.group(gatewayApi, "session", (group) =>
      group.handle("resolveSession", ({ headers }) =>
        handlers.resolveSession(headers)
      )
    ),
    HttpApiBuilder.group(gatewayApi, "episodeJobs", (group) =>
      group.handle("createEpisodeJob", ({ headers, payload }) =>
        handlers.createEpisodeJob({ headers, payload })
      )
    ),
    HttpApiBuilder.group(gatewayApi, "episodes", (group) =>
      group
        .handle("listEpisodes", ({ headers }) => handlers.listEpisodes(headers))
        .handle("createAudioAccess", ({ headers, params }) =>
          handlers.createAudioAccess({
            headers,
            episodeId: params.episodeId,
          })
        )
    )
  )
}
