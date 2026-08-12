import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect } from "effect"

import {
  acquireNatsGatewayPorts,
  makeGatewayWebHandler,
} from "../apps/gateway/src/index.js"
import { runNodeEpisodeLibraryRpc } from "../services/episode-library/src/runtime/index.js"
import { runNodeCreateJobRpc } from "../services/episode-production/src/index.js"
import { runNodeResolveSessionRpc } from "../services/identity-access/src/runtime/index.js"

const natsServers = ["nats://127.0.0.1:14222"]
const ownerId = "better-auth-e2e_user"
const articleA = "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
const articleB = "3c4d046c-b47b-4047-a562-66ac7e74e995"

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}

const json = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

const withRetry = async <Value>(operation: () => Promise<Value>) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw lastError
}

const request = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  init?: RequestInit
) => handler(new Request(`http://gateway.e2e${path}`, init))

const main = Effect.scoped(
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "functional-stack-e2e-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
    )

    yield* Effect.forkScoped(
      runNodeResolveSessionRpc(
        { natsServers, queueGroup: "identity-e2e" },
        {
          getSession: ({ headers }) =>
            Promise.resolve(
              headers.get("authorization") === "Bearer e2e-token"
                ? { user: { id: ownerId } }
                : null
            ),
        }
      )
    )
    yield* Effect.forkScoped(
      runNodeCreateJobRpc({
        sqlitePath: join(directory, "production.sqlite"),
        natsServers,
        queueGroup: "production-e2e",
      })
    )
    yield* Effect.forkScoped(
      runNodeEpisodeLibraryRpc(
        {
          sqlitePath: join(directory, "library.sqlite"),
          natsServers,
          queueGroup: "library-e2e",
        },
        {
          issue: () =>
            Effect.succeed(
              "https://audio.e2e.invalid/signed" as never
            ),
        }
      )
    )

    const ports = yield* acquireNatsGatewayPorts({
      natsServers,
      requestTimeoutMillis: 500,
      loginMethods: { development: true, google: false },
    })
    const web = makeGatewayWebHandler(ports)
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => web.dispose()).pipe(Effect.ignore)
    )

    return yield* Effect.tryPromise(async () => {
      const headers = {
        authorization: "Bearer e2e-token",
        "content-type": "application/json",
      }
      const session = await withRetry(async () => {
        const response = await request(web.handler, "/api/auth/state", {
          headers,
        })
        if (response.status !== 200) throw new Error("Identity RPC not ready")
        return json(response)
      })
      assert(session.authenticated === true, "expected authenticated session")
      assert(session.userId === ownerId, "opaque owner ID was not preserved")

      const create = (articleIds: readonly string[]) =>
        request(web.handler, "/v1/episode-jobs", {
          method: "POST",
          headers: { ...headers, "idempotency-key": "e2e-selection" },
          body: JSON.stringify({ trigger: "manual", articleIds }),
        })
      const firstResponse = await create([articleA, articleB])
      assert(firstResponse.status === 202, "first job was not accepted")
      const first = await json(firstResponse)

      const replayResponse = await create([articleB, articleA])
      assert(replayResponse.status === 202, "idempotent replay was rejected")
      const replay = await json(replayResponse)
      assert(first.id === replay.id, "idempotent replay created another job")

      const conflict = await create([articleA])
      assert(conflict.status === 409, "changed selection did not conflict")

      const episodesResponse = await request(web.handler, "/v1/episodes", {
        headers,
      })
      assert(episodesResponse.status === 200, "library RPC failed")
      const episodes = await json(episodesResponse)
      assert(
        Array.isArray(episodes.items) && episodes.items.length === 0,
        "new library was expected to be empty"
      )

      const anonymous = await request(web.handler, "/v1/episodes")
      assert(anonymous.status === 401, "anonymous owner boundary was bypassed")

      return {
        session: "authenticated",
        idempotency: "replayed",
        conflict: "rejected",
        ownerBoundary: "enforced",
        library: "reachable",
      }
    })
  })
)

void Effect.runPromise(main).then((result) => {
  console.log(JSON.stringify(result))
})
