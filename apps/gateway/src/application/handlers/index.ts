import { Layer } from "effect"

import type { GatewayPorts } from "../ports.js"
import { makeGatewayHandlers } from "./definitions.js"
import { systemGroup } from "./system.js"
import { sessionGroup } from "./session.js"
import { episodeJobsGroup } from "./episode-jobs.js"
import { episodesGroup } from "./episodes.js"
import { feedSubscriptionsGroup } from "./feed-subscriptions.js"
import { feedsGroup } from "./feeds.js"
import { articlesGroup } from "./articles.js"
import { personalizationGroup } from "./personalization.js"

export { makeGatewayHandlers, type GatewayHandlers } from "./definitions.js"

/**
 * 契約のグループ構成をそのままモジュール構成に写す。
 * endpoint を足すとき、触るファイルが1つに定まる。
 */
export const makeGatewayHandlerLayer = (
  ports: GatewayPorts,
  options: {
    readonly fetcher?: typeof globalThis.fetch
  } = {}
) => {
  const handlers = makeGatewayHandlers(ports, options)
  return Layer.mergeAll(
    systemGroup(handlers),
    sessionGroup(handlers),
    episodeJobsGroup(handlers),
    episodesGroup(handlers),
    feedSubscriptionsGroup(handlers),
    feedsGroup(handlers),
    articlesGroup(handlers),
    personalizationGroup(handlers)
  )
}
