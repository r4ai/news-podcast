import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { StorageType, jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"
import { Effect, Schema } from "effect"

import { readFirstSseEvent } from "./read-first-sse-event.mjs"
import {
  acquireNatsGatewayPorts,
  makeGatewayWebHandler,
} from "../apps/gateway/src/index.js"
import {
  runNatsContentKnowledgeRpc,
  startNodeRuntime,
} from "../services/content-knowledge/src/runtime/index.js"
import { makeArticleLibraryHandler } from "../services/content-knowledge/src/runtime/rpc/article-library-handler.js"
import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "../services/content-knowledge/src/domain/article.js"
import {
  defaultNodeEpisodeLibraryServiceDependencies,
  runNodeEpisodeLibraryService,
} from "../services/episode-library/src/runtime/node.js"
import { makeCompletionPublisher } from "../services/episode-production/src/adapters/messaging/completion-publisher.js"
import { relayCompletionOutbox } from "../services/episode-production/src/application/completion-outbox.js"
import { connectProductionJetStreamUnsafe } from "../services/episode-production/src/infrastructure/unsafe/nats-jetstream.js"
import {
  EpisodeIdSchema,
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  runNodeProductionRpc,
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

/** Libraryの署名器が返す先。この値へ来た取得だけを偽の上流が受ける。 */
const SIGNED_AUDIO_URL = "https://audio.e2e.invalid/signed"
/** 完成通知が申告するWAVの長さと合わせる。 */
const AUDIO_BYTE_LENGTH = 44

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
      runNodeProductionRpc({
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
    const e2eMarkdownReader = {
      read: () => Effect.succeed("# E2E article"),
    }
    yield* Effect.forkScoped(
      runNatsContentKnowledgeRpc(
        {
          natsServers,
          queueGroup: "content-e2e",
        },
        content,
        e2eMarkdownReader,
        undefined,
        makeArticleLibraryHandler({
          articles: content.library,
          objects: e2eMarkdownReader,
          now: () => "2026-08-23T00:00:00.000Z" as never,
          deriveArchiveRequestId: () =>
            "6c4d046c-b47b-4047-a562-66ac7e74e995" as never,
          archive: () => Effect.die("archive is outside this E2E"),
        })
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
              issue: () => Effect.succeed(SIGNED_AUDIO_URL as never),
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
    // 音声はGatewayが署名URLの中身を取りに行き、そのまま流し返す契約
    // (ADR-0055)。実体のS3は無いので、署名URLに対してだけ答える上流を挿す。
    // Rangeにも答えることで、206とcontent-rangeの転送まで確認できる。
    let requestedAudioUrl: string | undefined
    const audioBody = new Uint8Array(AUDIO_BYTE_LENGTH).fill(1)
    const audioUpstream: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : String(input)
      requestedAudioUrl = url
      if (url !== SIGNED_AUDIO_URL) {
        return new Response(null, { status: 404 })
      }
      const range = new Headers(init?.headers).get("range")
      if (range === null) {
        return new Response(audioBody, {
          status: 200,
          headers: {
            "accept-ranges": "bytes",
            "content-length": String(audioBody.byteLength),
            "content-type": "audio/wav",
          },
        })
      }
      const start = Number(/^bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      const slice = audioBody.subarray(start)
      return new Response(slice, {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(slice.byteLength),
          "content-range": `bytes ${start}-${audioBody.byteLength - 1}/${audioBody.byteLength}`,
          "content-type": "audio/wav",
        },
      })
    }
    const web = makeGatewayWebHandler(ports, undefined, {
      fetcher: audioUpstream,
    })
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
        if (response.status === 503) throw new Error("Content RPC not ready")
        return response
      })
      assert(addSubscription.status === 201, "subscription was not added")
      const added = await json(addSubscription)
      assert(typeof added.id === "string", "subscription ID missing")

      const subscriptionsResponse = await request(
        web.handler,
        "/v1/me/feed-subscriptions",
        { headers }
      )
      assert(
        subscriptionsResponse.status === 200,
        "subscriptions were not listed"
      )
      const subscriptions = await json(subscriptionsResponse)
      assert(
        Array.isArray(subscriptions.items) && subscriptions.items.length === 1,
        "owner subscription projection was not materialized"
      )

      // 本番と同じcatalog -> snapshot queue -> persistent FTS repository ->
      // NATS/Gateway検索を通す。ブラウザfakeのメモリ内filterでは検証しない。
      const feedId = String(added.feedId)
      const searchArticleId = "9c4d046c-b47b-4047-a562-66ac7e74e995"
      await Effect.runPromise(
        content.articles.upsert({
          articleId: searchArticleId as never,
          feedId: feedId as never,
          externalId: "body-search-e2e",
          sourceUrl: "https://example.com/indexed-article" as never,
          title: "Persistent search contract" as never,
          publishedAt: "2026-08-23T00:00:00.000Z",
          discoveredAt: "2026-08-23T00:01:00.000Z",
        })
      )
      const searchSnapshot = createArticleSnapshot({
        command: Schema.decodeUnknownSync(ArchiveCommandSchema)({
          archiveRequestId: "8c4d046c-b47b-4047-a562-66ac7e74e995",
          articleId: searchArticleId,
          sourceUrl: "https://example.com/indexed-article",
          title: "Persistent search contract",
        }),
        snapshotId: Schema.decodeUnknownSync(SnapshotIdSchema)(
          "7c4d046c-b47b-4047-a562-66ac7e74e995"
        ),
        capturedAt: Schema.decodeUnknownSync(CapturedAtSchema)(
          "2026-08-23T00:02:00.000Z"
        ),
        capture: Schema.decodeUnknownSync(ArchiveCaptureSchema)({
          rawResponse: {
            _tag: "RawResponse",
            key: "articles/search/raw/response.html",
            sha256: "1".repeat(64),
            mediaType: "text/html",
            byteLength: 10,
          },
          replay: {
            _tag: "Replay",
            key: "articles/search/replay/index.html",
            sha256: "2".repeat(64),
            mediaType: "text/html",
            byteLength: 10,
          },
          markdown: {
            _tag: "Markdown",
            key: "articles/search/markdown/article.md",
            sha256: "3".repeat(64),
            mediaType: "text/markdown",
            byteLength: 50,
          },
          assets: [],
        }),
      })
      await Effect.runPromise(
        content.store.commit({ snapshot: searchSnapshot })
      )
      const [searchPending] = await Effect.runPromise(
        content.searchIndex.listPending(10)
      )
      assert(searchPending !== undefined, "search index work was not queued")
      await Effect.runPromise(
        content.searchIndex.index({
          pending: searchPending,
          body: "この保存本文だけに body-only-needle が存在します。",
        })
      )
      const bodySearchResponse = await request(
        web.handler,
        "/v1/me/articles?q=body-only-needle&limit=1",
        { headers }
      )
      assert(
        bodySearchResponse.status === 200,
        `body search request failed: ${bodySearchResponse.status} ${await bodySearchResponse.clone().text()}`
      )
      const bodySearch = await json(bodySearchResponse)
      assert(
        Array.isArray(bodySearch.items) &&
          (bodySearch.items[0] as Record<string, unknown>)?.id ===
            searchArticleId,
        "persisted indexed body was not searchable through the public API"
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

      const jobId = String(first.id)
      const jobResponse = await withRetry(async () => {
        const response = await request(
          web.handler,
          `/v1/episode-jobs/${jobId}`,
          { headers }
        )
        if (response.status === 503)
          throw new Error("Job control RPC not ready")
        return response
      })
      assert(
        jobResponse.status === 200,
        `accepted job was not readable: ${jobResponse.status} ${await jobResponse.clone().text()}`
      )
      const job = await json(jobResponse)
      assert(job.id === jobId, "job detail returned another job")
      assert(typeof job.createdAt === "string", "job creation time was lost")

      const jobsResponse = await request(web.handler, "/v1/episode-jobs", {
        headers,
      })
      assert(jobsResponse.status === 200, "jobs were not listed")
      const jobs = await json(jobsResponse)
      assert(
        Array.isArray(jobs.items) &&
          jobs.items.some(
            (candidate) =>
              typeof candidate === "object" &&
              candidate !== null &&
              (candidate as Record<string, unknown>).id === jobId
          ),
        "accepted job was absent from its owner list"
      )

      const eventsResponse = await request(
        web.handler,
        `/v1/episode-jobs/${jobId}/events`,
        { headers: { ...headers, "last-event-id": "0" } }
      )
      assert(eventsResponse.status === 200, "job events were not replayed")
      const eventStream = await readFirstSseEvent(eventsResponse)
      assert(
        eventStream.includes("STATE_SNAPSHOT") && eventStream.includes(jobId),
        "job event replay omitted the state snapshot"
      )

      const canceledResponse = await request(
        web.handler,
        `/v1/episode-jobs/${jobId}/cancel`,
        { method: "POST", headers }
      )
      assert(canceledResponse.status === 200, "queued job was not canceled")
      const canceled = await json(canceledResponse)
      assert(
        canceled.status === "canceled",
        "cancel did not persist terminal state"
      )

      const retryCanceled = await request(
        web.handler,
        `/v1/episode-jobs/${jobId}/retry`,
        {
          method: "POST",
          headers: { ...headers, "idempotency-key": "retry-canceled" },
        }
      )
      assert(retryCanceled.status === 409, "non-failed job was retried")

      const publisher = await connectProductionJetStreamUnsafe(natsServers)
      try {
        let marked = false
        const jobId = Schema.decodeUnknownSync(JobIdSchema)(first.id)
        const completedEpisodeId =
          Schema.decodeUnknownSync(EpisodeIdSchema)(episodeId)
        const completedOwnerId =
          Schema.decodeUnknownSync(OwnerIdSchema)(ownerId)
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
      assert(
        Array.isArray(episodes.items) &&
          (
            (episodes.items[0] as Record<string, unknown>)[
              "sources"
            ] as readonly Record<string, unknown>[]
          )[0]?.articleId === articleA,
        "episode list did not retain the saved article link"
      )

      const episodeResponse = await request(
        web.handler,
        `/v1/episodes/${episodeId}`,
        { headers }
      )
      assert(episodeResponse.status === 200, "episode detail was not readable")
      const episodeDetail = await json(episodeResponse)
      assert(
        episodeDetail.id === episodeId,
        "episode detail returned another episode"
      )
      assert(
        Array.isArray(episodeDetail.sources) &&
          (episodeDetail.sources[0] as Record<string, unknown>).articleId ===
            articleA,
        "episode detail did not retain the saved article link"
      )

      // 署名URLはブラウザへ出さず、Gatewayがowner認可の後に中身を流す。
      const audioResponse = await request(
        web.handler,
        `/v1/episodes/${episodeId}/audio`,
        { headers }
      )
      assert(audioResponse.status === 200, "episode audio was not streamed")
      assert(
        requestedAudioUrl === SIGNED_AUDIO_URL,
        "audio access was not owner-scoped through Library"
      )
      assert(
        !audioResponse.headers.has("location"),
        "signed audio URL escaped the same-origin Gateway"
      )
      assert(
        audioResponse.headers.get("content-type") === "audio/wav",
        "episode audio lost its content type"
      )
      assert(
        audioResponse.headers.get("cache-control") === "private, no-store",
        "episode audio was cacheable"
      )
      const audioBytes = new Uint8Array(await audioResponse.arrayBuffer())
      assert(
        audioBytes.byteLength === AUDIO_BYTE_LENGTH,
        "episode audio body was truncated"
      )

      const rangeResponse = await request(
        web.handler,
        `/v1/episodes/${episodeId}/audio`,
        { headers: { ...headers, range: "bytes=8-" } }
      )
      assert(
        rangeResponse.status === 206,
        "audio range request was not partial"
      )
      assert(
        rangeResponse.headers.get("content-range") ===
          `bytes 8-${AUDIO_BYTE_LENGTH - 1}/${AUDIO_BYTE_LENGTH}`,
        "audio range response lost its content range"
      )

      const malformedRange = await request(
        web.handler,
        `/v1/episodes/${episodeId}/audio`,
        { headers: { ...headers, range: "bytes=abc" } }
      )
      assert(
        malformedRange.status === 416,
        "malformed audio range was not rejected"
      )

      const anonymousAudio = await request(
        web.handler,
        `/v1/episodes/${episodeId}/audio`
      )
      assert(
        anonymousAudio.status === 401,
        "episode audio was readable without a session"
      )

      const anonymous = await request(web.handler, "/v1/episodes")
      assert(anonymous.status === 401, "anonymous owner boundary was bypassed")

      return {
        session: "authenticated",
        idempotency: "replayed",
        conflict: "rejected",
        jobControl: "read-replay-cancel-fenced",
        subscription: "owner-scoped",
        articleBodySearch: "persistent-indexed-latest-snapshot",
        ownerBoundary: "enforced",
        completion: "jetstream-materialized",
        episodeDetail: "readable-with-same-origin-audio",
      }
    })
  })
)

void Effect.runPromise(main).then((result) => {
  console.log(JSON.stringify(result))
})
