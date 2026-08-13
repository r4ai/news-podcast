import { createServer, type Server } from "node:http"

import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

export type HealthState = Readonly<{
  isReady: () => boolean
  ready: () => void
  notReady: () => void
}>

export const createHealthState = (): HealthState => {
  let ready = false
  return deepFreeze({
    isReady: () => ready,
    ready: () => {
      ready = true
    },
    notReady: () => {
      ready = false
    },
  })
}

export type HealthServerFailure = Readonly<{
  _tag: "HealthServerFailure"
}>

export const healthServerScoped = (port: number, state: HealthState) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<Server>((resolve, reject) => {
          const server = createServer((request, response) => {
            response.setHeader("content-type", "application/json")
            response.setHeader("cache-control", "no-store")
            if (request.url === "/health/live") {
              response.statusCode = 200
              response.end('{"status":"live"}')
              return
            }
            if (request.url === "/health/ready") {
              response.statusCode = state.isReady() ? 200 : 503
              response.end(
                state.isReady()
                  ? '{"status":"ready"}'
                  : '{"status":"not_ready"}'
              )
              return
            }
            response.statusCode = 404
            response.end('{"status":"not_found"}')
          })
          server.once("error", reject)
          server.listen(port, "0.0.0.0", () => resolve(server))
        }),
      catch: (): HealthServerFailure => ({ _tag: "HealthServerFailure" }),
    }),
    (server) =>
      Effect.sync(state.notReady).pipe(
        Effect.andThen(
          Effect.promise(
            () => new Promise<void>((resolve) => server.close(() => resolve()))
          )
        )
      )
  )
