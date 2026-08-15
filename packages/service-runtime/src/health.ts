import { createServer, type Server } from "node:http"

import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

export type HealthState = Readonly<{
  isReady: () => boolean
  ready: (check?: string) => void
  notReady: (check?: string) => void
  snapshot: () => HealthSnapshot
}>

export type HealthSnapshot = Readonly<{
  ready: boolean
  checks: Readonly<Record<string, boolean>>
}>

const defaultCheck = "runtime"

export const createHealthState = (
  requiredChecks: readonly string[] = [defaultCheck]
): HealthState => {
  const checks = new Map<string, boolean>(
    [...new Set(requiredChecks.length === 0 ? [defaultCheck] : requiredChecks)]
      .sort()
      .map((check) => [check, false] as const)
  )
  const isReady = () => [...checks.values()].every(Boolean)
  return deepFreeze({
    isReady,
    ready: (check = defaultCheck) => {
      checks.set(check, true)
    },
    notReady: (check = defaultCheck) => {
      checks.set(check, false)
    },
    snapshot: () =>
      deepFreeze({
        ready: isReady(),
        checks: Object.fromEntries([...checks.entries()].sort()),
      }),
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
              const snapshot = state.snapshot()
              response.statusCode = snapshot.ready ? 200 : 503
              response.end(
                JSON.stringify({
                  status: snapshot.ready ? "ready" : "not_ready",
                  checks: snapshot.checks,
                })
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
