import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { StorageType, jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"
import { Effect, Schema } from "effect"

import {
  acquireNatsGatewayPorts,
  makeGatewayWebHandler,
} from "../apps/gateway/src/index.js"
import {
  runNatsContentKnowledgeRpc,
  startNodeRuntime,
} from "../services/content-knowledge/src/runtime/index.js"
import {
  defaultNodeEpisodeLibraryServiceDependencies,
  runNodeEpisodeLibraryService,
} from "../services/episode-library/src/runtime/node.js"
import { makeCompletionPublisher } from "../services/episode-production/src/adapters/completion-publisher.js"
import { relayCompletionOutbox } from "../services/episode-production/src/application/completion-outbox.js"
import { connectProductionJetStreamUnsafe } from "../services/episode-production/src/infrastructure/unsafe/nats-jetstream.js"
import {
  EpisodeIdSchema,
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  runNodeCreateJobRpc,
} from "../services/episode-production/src/index.js"
import { runNodeResolveSessionRpc } from "../services/identity-access/src/runtime/index.js"

const natsServers = ["nats://127.0.0.1:14222"]
const ownerId = "better-auth-e2e_user"
const articleA = "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
const articleB = "3c4d046c-b47b-4047-a562-66ac7e74e995"
const episodeId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"

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

    const provisionConnection = yield* Effect.acquireRelease(
      Effect.promise(() => connect({ servers: natsServers })),
      (connection) => Effect.promise(() => connection.close())
    )
    const manager = yield* Effect.promise(() =>
      jetstream(provisionConnection).jetstreamManager()
    )
    yield* Effect.promise(() =>
      manager.streams.add({
        name: "EPISODE_PRODUCTION",
        subjects: ["production.job-completed.v2"],
        storage: StorageType.Memory,
      })
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
    const content = yield* Effect.acquireRelease(
      startNodeRuntime({
        sqlitePath: join(directory, "content.sqlite"),
        natsServers,
      }),
      (runtime) => runtime.close().pipe(Effect.ignore)
    )
    yield* Effect.forkScoped(
      runNatsContentKnowledgeRpc(
        {
          natsServers,
          queueGroup: "content-e2e",
        },
        content,
        { read: () => Effect.succeed("# E2E article") }
      )
    )
    yield* Effect.forkScoped(
      runNodeEpisodeLibraryService(
        {
          sqlitePath: join(directory, "library.sqlite"),
          natsServers,
          queueGroup: "library-e2e",
          completionConsumer: {
            stream: "EPISODE_PRODUCTION",
            durableName: "library-e2e-completions",
            ackWaitMillis: 5_000,
            maximumDeliveries: 5,
            initialNackDelayMillis: 100,
            maximumNackDelayMillis: 1_000,
          },
          s3: {
            endpoint: "http://s3.e2e.invalid",
            region: "us-east-1",
            bucket: "e2e-audio",
            accessKeyId: "e2e-access",
            secretAccessKey: "e2e-secret",
          },
        },
        {
          ...defaultNodeEpisodeLibraryServiceDependencies,
          openSigner: () => ({
            signer: {
              issue: () =>
                Effect.succeed("https://audio.e2e.invalid/signed" as never),
            },
            close: Effect.void,
          }),
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

      const addSubscription = await withRetry(async () => {
        const response = await request(
          web.handler,
          "/v1/me/feed-subscriptions",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              feedUrl: "https://feeds.example.com/e2e.xml",
            }),
          }
        )
        if (response.status === 503)
          throw new Error("Content RPC not ready")
        return response
      })
      assert(addSubscription.status === 201, "subscription was not added")
      const added = await json(addSubscription)
      assert(typeof added.subscriptionId === "string", "subscription ID missing")

      const subscriptionsResponse = await request(
        web.handler,
        "/v1/me/feed-subscriptions",
        { headers }
      )
      assert(subscriptionsResponse.status === 200, "subscriptions were not listed")
      const subscriptions = await json(subscriptionsResponse)
      assert(
        Array.isArray(subscriptions.items) && subscriptions.items.length === 1,
        "owner subscription projection was not materialized"
      )

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

      const publisher = await connectProductionJetStreamUnsafe(natsServers)
      try {
        let marked = false
        const jobId = Schema.decodeUnknownSync(JobIdSchema)(first.id)
        const completedEpisodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
          episodeId
        )
        const completedOwnerId = Schema.decodeUnknownSync(OwnerIdSchema)(ownerId)
        const completedAt = Schema.decodeUnknownSync(UtcTimestampSchema)(
          "2026-08-13T00:02:00.000Z"
        )
        await Effect.runPromise(
          relayCompletionOutbox({
            listPending: () =>
              Effect.succeed([
                {
                  jobId,
                  completion: {
                    episodeId: completedEpisodeId,
                    ownerId: completedOwnerId,
                    title: "Functional E2E daily news",
                    script: "A complete generated script.",
                    audio: {
                      episodeId: completedEpisodeId,
                      objectKey: `episodes/e2e/${jobId}/${episodeId}.wav`,
                      byteLength: 44,
                      contentType: "audio/wav",
                    },
                    sources: [
                      {
                        articleId: articleA,
                        snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4",
                        url: "https://example.com/e2e-news",
                        title: "E2E news",
                      },
                    ] as never,
                    completedAt,
                    traceparent:
                      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
                  },
                },
              ]),
            publish: makeCompletionPublisher(publisher),
            markPublished: () =>
              Effect.sync(() => {
                marked = true
              }),
            now: () => completedAt,
          })
        )
        assert(marked, "completion outbox was not marked after publish")
      } finally {
        await publisher.close()
      }

      const episodes = await withRetry(async () => {
        const response = await request(web.handler, "/v1/episodes", { headers })
        if (response.status !== 200) throw new Error("Library RPC not ready")
        const body = await json(response)
        if (!Array.isArray(body.items) || body.items.length !== 1)
          throw new Error("completion event not consumed")
        return body
      })
      assert(
        Array.isArray(episodes.items) &&
          (episodes.items[0] as Record<string, unknown>).id === episodeId,
        "completed episode did not reach the owner library"
      )

      const anonymous = await request(web.handler, "/v1/episodes")
      assert(anonymous.status === 401, "anonymous owner boundary was bypassed")

      return {
        session: "authenticated",
        idempotency: "replayed",
        conflict: "rejected",
        subscription: "owner-scoped",
        ownerBoundary: "enforced",
        completion: "jetstream-materialized",
      }
    })
  })
)

void Effect.runPromise(main).then((result) => {
  console.log(JSON.stringify(result))
})
