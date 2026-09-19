import { Clock, Effect, Metric } from "effect"

/** Uncompressed UTF-8 JSON budget: 20 maximum-length (500 character) titles. */
export const EPISODE_LIST_PAYLOAD_BUDGET_BYTES = 40_000
export const EPISODE_LIST_LATENCY_BUDGET_MILLIS = 500

export const episodeListPayloadBytes = Metric.histogram(
  "episode.list.payload.bytes",
  {
    description: "Uncompressed successful HTTP list JSON payload bytes",
    boundaries: [
      2_000,
      5_000,
      10_000,
      20_000,
      EPISODE_LIST_PAYLOAD_BUDGET_BYTES,
      80_000,
      1_000_000,
    ],
  }
)
export const episodeListLatencyMillis = Metric.histogram(
  "episode.list.duration.millis",
  {
    description:
      "List handler duration including authentication and library RPC; all outcomes",
    boundaries: [
      10,
      50,
      100,
      250,
      EPISODE_LIST_LATENCY_BUDGET_MILLIS,
      1_000,
      5_000,
    ],
  }
)

/** No owner, cursor, title, or payload content is attached to metrics. */
export const observeEpisodeList = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    return yield* effect.pipe(
      Effect.tap((page) =>
        Metric.update(
          episodeListPayloadBytes,
          new TextEncoder().encode(JSON.stringify(page)).byteLength
        )
      ),
      Effect.ensuring(
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((ended) =>
            Metric.update(
              episodeListLatencyMillis,
              Math.max(0, ended - started)
            )
          )
        )
      )
    )
  })
