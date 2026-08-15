import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
} from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readIdentityAccessConfig } from "./runtime/env.js"
import { startIdentityAccessProcess } from "./runtime/process.js"
import { defaultIdentityAccessServiceDependencies } from "./runtime/service.js"
import { listenIdentityHttpUnsafe } from "./infrastructure/unsafe/node-http.js"

const observability = getNodeObservability({
  serviceName: "identity-access",
  traceSampleRate: 1,
})
const effectTelemetry = makeEffectOtlpLayerFromEnvironment(
  process.env,
  "identity-access"
)
const health = createHealthState(["rpc"])
const core = readIdentityAccessConfig(process.env)
  .pipe(
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* Effect.acquireRelease(
            defaultIdentityAccessServiceDependencies.startRuntime(config),
            (resource) => resource.close()
          )
          const http = yield* Effect.acquireRelease(
            Effect.tryPromise(() =>
              listenIdentityHttpUnsafe({
                hostname: config.httpHost,
                port: config.httpPort,
                handler: runtime.authHandler,
              })
            ),
            (server) => Effect.promise(() => server.close()).pipe(Effect.ignore)
          )
          void http
          return yield* defaultIdentityAccessServiceDependencies.runRpc(
            { natsServers: config.natsServers, queueGroup: config.queueGroup },
            runtime.api,
            runtime.settings,
            () => health.ready("rpc")
          )
        })
      )
    )
  )
  .pipe(Effect.provide(effectTelemetry))
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.IDENTITY_HEALTH_PORT ?? "4102"),
    health
  ).pipe(
    Effect.andThen(core),
    Effect.ensuring(Effect.sync(() => health.notReady("rpc")))
  )
)

startIdentityAccessProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  onceFatal: (event, listener) => process.once(event, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error(JSON.stringify(failure)),
})
