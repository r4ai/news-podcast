import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import {
  parseNodeCreateJobRpcConfig,
  type NodeCreateJobRpcError,
} from "./node.js"

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
