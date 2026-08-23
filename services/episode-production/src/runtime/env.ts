import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"
import { readProviderRuntimeMode } from "@news-podcast/service-runtime"

import {
  parseNodeCreateJobRpcConfig,
  type NodeCreateJobRpcError,
} from "./node.js"
import {
  parseNodeEpisodeProductionServiceConfig,
  type NodeEpisodeProductionServiceError,
} from "./service.js"

const configFailure = (): NodeCreateJobRpcError =>
  deepFreeze({
    _tag: "NodeCreateJobRpcFailed" as const,
    component: "Config" as const,
  })

/** Reads only service-owned persistence configuration; shared DATABASE_PATH is ignored. */
export const readEpisodeProductionConfig = (
  env: Readonly<Record<string, string | undefined>>
) => {
  const sqlitePath = env.EPISODE_PRODUCTION_DATABASE_PATH?.trim() ?? ""
  if (sqlitePath === "" || sqlitePath === ":memory:") {
    return Effect.fail(configFailure())
  }
  const natsServers = (env.NATS_SERVERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const queueGroup = env.EPISODE_PRODUCTION_QUEUE_GROUP?.trim() ?? ""

  return parseNodeCreateJobRpcConfig({
    sqlitePath,
    natsServers,
    queueGroup,
  }).pipe(Effect.mapError(configFailure))
}

const serviceConfigFailure = (): NodeEpisodeProductionServiceError =>
  deepFreeze({
    _tag: "NodeEpisodeProductionServiceFailed" as const,
    component: "Config" as const,
  })

const integer = (value: string | undefined, fallback: number): number =>
  value === undefined || value.trim() === "" ? fallback : Number(value)

/** Strict projection of every external dependency owned by Production. */
export const readEpisodeProductionServiceConfig = (
  env: Readonly<Record<string, string | undefined>>
) =>
  Effect.all([
    readEpisodeProductionConfig(env),
    readProviderRuntimeMode(env),
  ]).pipe(
    Effect.flatMap(([rpc, providerRuntime]) =>
      parseNodeEpisodeProductionServiceConfig({
        rpc,
        appEnvironment: providerRuntime.appEnvironment,
        contentRequestTimeoutMillis: integer(
          env.CONTENT_REQUEST_TIMEOUT_MS,
          5_000
        ),
        providerMode: providerRuntime.providerMode,
        openAi: {
          apiUrl: env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1",
          apiKey: env.OPENAI_API_KEY?.trim() ?? "",
          model:
            env.OPENAI_MODEL?.trim() ||
            (providerRuntime.providerMode === "fake" ? "fake" : ""),
          requestTimeoutMillis: integer(env.OPENAI_REQUEST_TIMEOUT_MS, 120_000),
          retryPolicy: {
            maximumAttempts: integer(env.PROVIDER_MAXIMUM_ATTEMPTS, 3),
            maximumElapsedMillis: integer(
              env.PROVIDER_MAXIMUM_ELAPSED_MS,
              180_000
            ),
            baseDelayMillis: integer(env.PROVIDER_BASE_DELAY_MS, 1_000),
            maximumDelayMillis: integer(env.PROVIDER_MAXIMUM_DELAY_MS, 30_000),
          },
        },
        voicevox: {
          baseUrl: env.VOICEVOX_BASE_URL?.trim() ?? "",
          characterName: env.VOICEVOX_CHARACTER_NAME?.trim() ?? "",
          ...(env.VOICEVOX_STYLE_NAME?.trim()
            ? { styleName: env.VOICEVOX_STYLE_NAME.trim() }
            : {}),
          requestTimeoutMillis: integer(
            env.VOICEVOX_REQUEST_TIMEOUT_MS,
            60_000
          ),
          maximumAudioBytes: integer(
            env.VOICEVOX_MAXIMUM_AUDIO_BYTES,
            134_217_728
          ),
          maximumTextCharactersPerRequest: integer(
            env.VOICEVOX_MAXIMUM_TEXT_CHARACTERS,
            200
          ),
          retryPolicy: {
            maximumAttempts: integer(env.PROVIDER_MAXIMUM_ATTEMPTS, 3),
            maximumElapsedMillis: integer(
              env.PROVIDER_MAXIMUM_ELAPSED_MS,
              180_000
            ),
            baseDelayMillis: integer(env.PROVIDER_BASE_DELAY_MS, 1_000),
            maximumDelayMillis: integer(env.PROVIDER_MAXIMUM_DELAY_MS, 30_000),
          },
        },
        s3: {
          endpoint: env.S3_ENDPOINT?.trim() ?? "",
          region: env.S3_REGION?.trim() ?? "",
          bucket: env.S3_BUCKET?.trim() ?? "",
          accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
          requestTimeoutMillis: integer(env.S3_REQUEST_TIMEOUT_MS, 60_000),
        },
        worker: {
          leaseMillis: integer(env.EPISODE_WORKER_LEASE_MS, 300_000),
          heartbeatMillis: integer(env.EPISODE_WORKER_HEARTBEAT_MS, 60_000),
          cancellationPollMillis: integer(
            env.EPISODE_WORKER_CANCELLATION_POLL_MS,
            250
          ),
          retryDelayMillis: integer(env.EPISODE_WORKER_RETRY_DELAY_MS, 30_000),
          idleMillis: integer(env.EPISODE_WORKER_IDLE_MS, 1_000),
        },
        completionRelay: {
          batchSize: integer(env.EPISODE_COMPLETION_BATCH_SIZE, 50),
          intervalMillis: integer(env.EPISODE_COMPLETION_INTERVAL_MS, 1_000),
          initialBackoffMillis: integer(
            env.EPISODE_COMPLETION_INITIAL_BACKOFF_MS,
            1_000
          ),
          maximumBackoffMillis: integer(
            env.EPISODE_COMPLETION_MAX_BACKOFF_MS,
            30_000
          ),
        },
        scheduler: {
          intervalMillis: integer(env.EPISODE_SCHEDULER_INTERVAL_MS, 60_000),
          failureBackoffMillis: integer(
            env.EPISODE_SCHEDULER_FAILURE_BACKOFF_MS,
            5_000
          ),
          requestTimeoutMillis: integer(
            env.EPISODE_SCHEDULER_REQUEST_TIMEOUT_MS,
            5_000
          ),
        },
      }).pipe(Effect.mapError(serviceConfigFailure))
    ),
    Effect.mapError(serviceConfigFailure)
  )
