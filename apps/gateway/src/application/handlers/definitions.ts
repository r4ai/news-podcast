import { deepFreeze } from "@news-podcast/kernel"
import { parseEpisodeJobAgUiEvent } from "@news-podcast/contracts/agui"
import { Effect, Option, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { EpisodeJobAgUiEventSchema } from "../../contract.js"
import type { GatewayPorts } from "../ports.js"

const freezeSuccess = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>
) => effect.pipe(Effect.map(deepFreeze))

type EpisodeReplay = Effect.Success<
  ReturnType<GatewayPorts["replayEpisodeJobEvents"]>
>
type EpisodeJob = EpisodeReplay["snapshot"]
type EpisodeTailState = Readonly<{
  afterSequence: number
  replaying: boolean
}>

const isTerminalEpisodeJob = (job: EpisodeJob) =>
  job.status === "succeeded" ||
  job.status === "failed" ||
  job.status === "canceled"

const toEpisodeJobState = (job: EpisodeJob) =>
  deepFreeze({
    jobId: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    selectionMode:
      job.articleIds === undefined
        ? ("automatic" as const)
        : ("manual" as const),
    selectedArticles: (job.articleIds ?? []).map((articleId) => ({
      articleId,
    })),
    ...(job.failure === undefined
      ? {}
      : {
          failure: {
            code: job.failure.code,
            message: job.failure.message,
            retryable: job.failure.retryable,
          },
        }),
    ...(job.episodeId === undefined ? {} : { episodeId: job.episodeId }),
  })

type EpisodeSseEvent = Readonly<{
  id: string | undefined
  event: "message"
  data: Schema.Schema.Type<typeof EpisodeJobAgUiEventSchema>
}>

const toSnapshotSseEvent = (job: EpisodeJob): EpisodeSseEvent =>
  deepFreeze({
    id: undefined,
    event: "message",
    data: deepFreeze({
      type: "STATE_SNAPSHOT" as const,
      timestamp: Date.parse(
        job.finishedAt ??
          job.lastProgressAt ??
          job.startedAt ??
          job.nextAttemptAt ??
          job.createdAt
      ),
      snapshot: toEpisodeJobState(job),
    }),
  })

const toEpisodeSseEvent = (sequence: number, value: unknown): EpisodeSseEvent =>
  deepFreeze({
    id: String(sequence),
    event: "message",
    data: Schema.decodeUnknownSync(EpisodeJobAgUiEventSchema)(
      parseEpisodeJobAgUiEvent(value)
    ),
  })

const latestSequence = (fallback: number, replay: EpisodeReplay) =>
  replay.events.reduce(
    (latest, event) => Math.max(latest, event.sequence),
    fallback
  )

export const makeGatewayHandlers = (
  ports: GatewayPorts,
  options: {
    readonly episodeEventPollMillis?: number
    readonly fetcher?: typeof globalThis.fetch
  } = {}
) =>
  deepFreeze({
    health: () => freezeSuccess(ports.health()),
    resolveSession: (headers: Parameters<GatewayPorts["resolveSession"]>[0]) =>
      freezeSuccess(ports.resolveSession(deepFreeze(headers))),
    createEpisodeJob: (
      input: Parameters<GatewayPorts["createEpisodeJob"]>[0]
    ) => freezeSuccess(ports.createEpisodeJob(deepFreeze(input))),
    listEpisodeJobs: (input: Parameters<GatewayPorts["listEpisodeJobs"]>[0]) =>
      freezeSuccess(ports.listEpisodeJobs(deepFreeze(input))),
    getEpisodeJob: (input: Parameters<GatewayPorts["getEpisodeJob"]>[0]) =>
      freezeSuccess(ports.getEpisodeJob(deepFreeze(input))),
    cancelEpisodeJob: (
      input: Parameters<GatewayPorts["cancelEpisodeJob"]>[0]
    ) => freezeSuccess(ports.cancelEpisodeJob(deepFreeze(input))),
    retryEpisodeJob: (input: Parameters<GatewayPorts["retryEpisodeJob"]>[0]) =>
      freezeSuccess(ports.retryEpisodeJob(deepFreeze(input))),
    streamEpisodeJobEvents: (
      input: Parameters<GatewayPorts["replayEpisodeJobEvents"]>[0]
    ) =>
      ports.replayEpisodeJobEvents(deepFreeze(input)).pipe(
        Effect.map((initial) => {
          const initialHasMoreReplay = initial.events.length === 100
          const initialEvents = [
            ...initial.events.map(({ sequence, event }) =>
              toEpisodeSseEvent(sequence, event)
            ),
            // Do not place the current snapshot before a later replay page.
            ...(initialHasMoreReplay
              ? []
              : initial.events.length === 0
                ? [toSnapshotSseEvent(initial.snapshot)]
                : []),
          ]
          const initialSequence = latestSequence(input.afterSequence, initial)
          const initialIsComplete =
            isTerminalEpisodeJob(initial.snapshot) && !initialHasMoreReplay
          if (initialIsComplete) {
            return Stream.fromIterable(initialEvents)
          }

          const tail = Stream.paginate(
            {
              afterSequence: initialSequence,
              replaying: initialHasMoreReplay,
            },
            (state) =>
              Effect.sleep(options.episodeEventPollMillis ?? 1_000).pipe(
                Effect.andThen(
                  ports.replayEpisodeJobEvents(
                    deepFreeze({
                      ...input,
                      afterSequence: state.afterSequence,
                    })
                  )
                ),
                Effect.matchEffect({
                  onFailure: () =>
                    Effect.logWarning("episode job event tail stopped", {
                      event_name: "episode.events_tail_stopped",
                      job_id: input.jobId,
                    }).pipe(
                      Effect.as([
                        [] as ReadonlyArray<
                          ReturnType<typeof toEpisodeSseEvent>
                        >,
                        Option.none<EpisodeTailState>(),
                      ] as const)
                    ),
                  onSuccess: (replay) => {
                    const nextSequence = latestSequence(
                      state.afterSequence,
                      replay
                    )
                    const fullReplayPage = replay.events.length === 100
                    const terminalSnapshotWithoutEvent =
                      !state.replaying &&
                      replay.events.length === 0 &&
                      isTerminalEpisodeJob(replay.snapshot)
                    const events: Array<
                      | ReturnType<typeof toEpisodeSseEvent>
                      | ReturnType<typeof toSnapshotSseEvent>
                    > = replay.events.map(({ sequence, event }) =>
                      toEpisodeSseEvent(sequence, event)
                    )
                    if (terminalSnapshotWithoutEvent) {
                      events.push(toSnapshotSseEvent(replay.snapshot))
                    }
                    const complete =
                      isTerminalEpisodeJob(replay.snapshot) && !fullReplayPage
                    return Effect.succeed([
                      events,
                      complete
                        ? Option.none()
                        : Option.some({
                            afterSequence: nextSequence,
                            replaying: fullReplayPage,
                          }),
                    ] as const)
                  },
                })
              )
          )
          return Stream.concat(Stream.fromIterable(initialEvents), tail)
        })
      ),
    listEpisodes: (input: Parameters<GatewayPorts["listEpisodes"]>[0]) =>
      freezeSuccess(ports.listEpisodes(deepFreeze(input))),
    getEpisode: (input: Parameters<GatewayPorts["getEpisode"]>[0]) =>
      freezeSuccess(ports.getEpisode(deepFreeze(input))),
    streamEpisodeAudio: (input: {
      readonly headers: Parameters<
        GatewayPorts["createAudioAccess"]
      >[0]["headers"] & {
        readonly range?: string | undefined
      }
      readonly episodeId: Parameters<
        GatewayPorts["createAudioAccess"]
      >[0]["episodeId"]
    }) => {
      const { range, ...headers } = input.headers
      if (range !== undefined && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
        return Effect.succeed(
          HttpServerResponse.empty({
            status: 416,
            headers: { "cache-control": "private, no-store" },
          })
        )
      }
      return ports
        .createAudioAccess(deepFreeze({ headers, episodeId: input.episodeId }))
        .pipe(
          Effect.flatMap((access) => {
            return Effect.tryPromise({
              try: async () => {
                const upstream = await (options.fetcher ?? globalThis.fetch)(
                  access.url,
                  { headers: range === undefined ? {} : { range } }
                )
                if (![200, 206, 416].includes(upstream.status)) {
                  await upstream.body?.cancel()
                  throw new Error("audio upstream unavailable")
                }
                const headers = new Headers({
                  "cache-control": "private, no-store",
                  "content-disposition": "inline",
                })
                for (const name of [
                  "accept-ranges",
                  "content-length",
                  "content-range",
                  "content-type",
                  "etag",
                  "last-modified",
                ]) {
                  const value = upstream.headers.get(name)
                  if (value !== null) headers.set(name, value)
                }
                return HttpServerResponse.fromWeb(
                  new Response(upstream.body, {
                    status: upstream.status,
                    headers,
                  })
                )
              },
              catch: () => ({
                type: "about:blank" as const,
                title: "Unavailable" as const,
                status: 503 as const,
                code: "upstream_unavailable" as const,
              }),
            })
          })
        )
    },
    addFeedSubscription: (
      input: Parameters<GatewayPorts["addFeedSubscription"]>[0]
    ) => freezeSuccess(ports.addFeedSubscription(deepFreeze(input))),
    listFeedSubscriptions: (
      headers: Parameters<GatewayPorts["listFeedSubscriptions"]>[0]
    ) => freezeSuccess(ports.listFeedSubscriptions(deepFreeze(headers))),
    listFeedSyncJobs: (
      headers: Parameters<GatewayPorts["listFeedSyncJobs"]>[0]
    ) => freezeSuccess(ports.listFeedSyncJobs(deepFreeze(headers))),
    syncFeedSubscription: (
      input: Parameters<GatewayPorts["syncFeedSubscription"]>[0]
    ) => freezeSuccess(ports.syncFeedSubscription(deepFreeze(input))),
    deleteFeedSubscription: (
      input: Parameters<GatewayPorts["deleteFeedSubscription"]>[0]
    ) => freezeSuccess(ports.deleteFeedSubscription(deepFreeze(input))),
    updateFeedSubscription: (
      input: Parameters<GatewayPorts["updateFeedSubscription"]>[0]
    ) => freezeSuccess(ports.updateFeedSubscription(deepFreeze(input))),
    listFeeds: (input: Parameters<GatewayPorts["listFeeds"]>[0]) =>
      freezeSuccess(ports.listFeeds(deepFreeze(input))),
    registerFeed: (input: Parameters<GatewayPorts["registerFeed"]>[0]) =>
      freezeSuccess(ports.registerFeed(deepFreeze(input))),
    listArticles: (input: Parameters<GatewayPorts["listArticles"]>[0]) =>
      freezeSuccess(ports.listArticles(deepFreeze(input))),
    getArticle: (input: Parameters<GatewayPorts["getArticle"]>[0]) =>
      freezeSuccess(ports.getArticle(deepFreeze(input))),
    getArticleMarkdown: (
      input: Parameters<GatewayPorts["getArticleMarkdown"]>[0]
    ) => freezeSuccess(ports.getArticleMarkdown(deepFreeze(input))),
    patchArticle: (input: Parameters<GatewayPorts["patchArticle"]>[0]) =>
      freezeSuccess(ports.patchArticle(deepFreeze(input))),
    bulkPatchArticles: (
      input: Parameters<GatewayPorts["bulkPatchArticles"]>[0]
    ) => freezeSuccess(ports.bulkPatchArticles(deepFreeze(input))),
    getArticleFacets: (
      input: Parameters<GatewayPorts["getArticleFacets"]>[0]
    ) => freezeSuccess(ports.getArticleFacets(deepFreeze(input))),
    archiveArticle: (input: Parameters<GatewayPorts["archiveArticle"]>[0]) =>
      freezeSuccess(ports.archiveArticle(deepFreeze(input))),
    listArticleTags: (input: Parameters<GatewayPorts["listArticleTags"]>[0]) =>
      freezeSuccess(ports.listArticleTags(deepFreeze(input))),
    setArticleTags: (input: Parameters<GatewayPorts["setArticleTags"]>[0]) =>
      freezeSuccess(ports.setArticleTags(deepFreeze(input))),
    enrichArticle: (input: Parameters<GatewayPorts["enrichArticle"]>[0]) =>
      freezeSuccess(ports.enrichArticle(deepFreeze(input))),
    getSettings: (headers: Parameters<GatewayPorts["getSettings"]>[0]) =>
      freezeSuccess(ports.getSettings(deepFreeze(headers))),
    updateSettings: (input: Parameters<GatewayPorts["updateSettings"]>[0]) =>
      freezeSuccess(ports.updateSettings(deepFreeze(input))),
    listTags: (headers: Parameters<GatewayPorts["listTags"]>[0]) =>
      freezeSuccess(ports.listTags(deepFreeze(headers))),
    createTag: (input: Parameters<GatewayPorts["createTag"]>[0]) =>
      freezeSuccess(ports.createTag(deepFreeze(input))),
    deleteTag: (input: Parameters<GatewayPorts["deleteTag"]>[0]) =>
      freezeSuccess(ports.deleteTag(deepFreeze(input))),
    listTagSuggestions: (
      headers: Parameters<GatewayPorts["listTagSuggestions"]>[0]
    ) => freezeSuccess(ports.listTagSuggestions(deepFreeze(headers))),
    promoteTagSuggestion: (
      input: Parameters<GatewayPorts["promoteTagSuggestion"]>[0]
    ) => freezeSuccess(ports.promoteTagSuggestion(deepFreeze(input))),
    listReadingDictionary: (
      headers: Parameters<GatewayPorts["listReadingDictionary"]>[0]
    ) => freezeSuccess(ports.listReadingDictionary(deepFreeze(headers))),
    createReadingDictionary: (
      input: Parameters<GatewayPorts["createReadingDictionary"]>[0]
    ) => freezeSuccess(ports.createReadingDictionary(deepFreeze(input))),
    updateReadingDictionary: (
      input: Parameters<GatewayPorts["updateReadingDictionary"]>[0]
    ) => freezeSuccess(ports.updateReadingDictionary(deepFreeze(input))),
    deleteReadingDictionary: (
      input: Parameters<GatewayPorts["deleteReadingDictionary"]>[0]
    ) => freezeSuccess(ports.deleteReadingDictionary(deepFreeze(input))),
    getEnrichQueue: (headers: Parameters<GatewayPorts["getEnrichQueue"]>[0]) =>
      freezeSuccess(ports.getEnrichQueue(deepFreeze(headers))),
    enrichReprocess: (
      headers: Parameters<GatewayPorts["enrichReprocess"]>[0]
    ) => freezeSuccess(ports.enrichReprocess(deepFreeze(headers))),
    enrichResetDaily: (
      headers: Parameters<GatewayPorts["enrichResetDaily"]>[0]
    ) => freezeSuccess(ports.enrichResetDaily(deepFreeze(headers))),
  })

export type GatewayHandlers = ReturnType<typeof makeGatewayHandlers>
