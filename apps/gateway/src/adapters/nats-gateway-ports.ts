import { deepFreeze } from "@news-podcast/kernel"
import { Effect, type Scope } from "effect"

import {
  connectNatsRequestClientUnsafe,
  type UnsafeNatsRequestClient,
} from "../infrastructure/unsafe/nats-request.js"
import {
  currentUtcInstantUnsafe,
  randomUuidUnsafe,
} from "../infrastructure/unsafe/runtime-values.js"
import type { GatewayPorts } from "../application/ports.js"
import { makeAgentAuditPorts } from "./nats/agent-audit-ports.js"
import { makeArticlePorts } from "./nats/article-ports.js"
import { makeEnrichmentPorts } from "./nats/enrichment-ports.js"
import { makeEpisodeJobPorts } from "./nats/episode-job-ports.js"
import { makeEpisodeLibraryPorts } from "./nats/episode-library-ports.js"
import { makeFeedPorts } from "./nats/feed-ports.js"
import { unavailable } from "./nats/problems.js"
import { makeReadingDictionaryPorts } from "./nats/reading-dictionary-ports.js"
import { makeSessionPorts } from "./nats/session-ports.js"
import { makeSettingsPorts } from "./nats/settings-ports.js"
import { makeTaxonomyPorts } from "./nats/taxonomy-ports.js"
import {
  type AdapterOptions,
  type Dependencies,
  makeTransport,
} from "./nats/transport.js"

/**
 * GatewayPortsの合成点。搬送層をひとつ組み立て、文脈ごとのポート群へ配る。
 * 個々の射影と問題詳細の翻訳は`./nats/`配下の各モジュールが持つ。
 */

export { ProductionCreateEpisodeJobResponseSchema } from "./nats/episode-job-ports.js"
export type { AdapterOptions, Dependencies }

const makeAdapter = (
  client: UnsafeNatsRequestClient,
  dependencies: Dependencies,
  options: AdapterOptions
): GatewayPorts => {
  const transport = makeTransport(client, dependencies, options)

  return deepFreeze({
    ...makeSessionPorts(transport),
    ...makeEpisodeJobPorts(transport),
    ...makeEpisodeLibraryPorts(transport),
    ...makeFeedPorts(transport),
    ...makeArticlePorts(transport),
    ...makeAgentAuditPorts(transport),
    ...makeSettingsPorts(transport),
    ...makeTaxonomyPorts(transport),
    ...makeReadingDictionaryPorts(transport),
    ...makeEnrichmentPorts(transport),
  } satisfies GatewayPorts)
}

export const makeNatsGatewayPorts = (
  client: UnsafeNatsRequestClient,
  dependencies: Dependencies
): GatewayPorts =>
  makeAdapter(client, dependencies, {
    requestTimeoutMillis: 2_000,
    loginMethods: { development: false, google: true },
  })

export const acquireNatsGatewayPorts = (
  config: Readonly<{
    natsServers: readonly string[]
    requestTimeoutMillis: number
    loginMethods: { readonly development: boolean; readonly google: boolean }
  }>,
  dependencies: Dependencies & {
    connect?: (servers: readonly string[]) => Promise<UnsafeNatsRequestClient>
  } = {
    nextMessageId: randomUuidUnsafe,
    now: currentUtcInstantUnsafe,
  }
): Effect.Effect<GatewayPorts, unknown, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        (dependencies.connect ?? connectNatsRequestClientUnsafe)(
          config.natsServers
        ),
      catch: unavailable,
    }),
    (client) => Effect.promise(() => client.drain()).pipe(Effect.ignore)
  ).pipe(Effect.map((client) => makeAdapter(client, dependencies, config)))
