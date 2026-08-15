import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** 購読の登録・一覧・同期。 */
export const feedSubscriptionsGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "feedSubscriptions", (group) =>
    group
      .handle("addFeedSubscription", ({ headers, payload }) =>
        handlers.addFeedSubscription({ headers, payload })
      )
      .handle("listFeedSubscriptions", ({ headers }) =>
        handlers.listFeedSubscriptions(headers)
      )
      .handle("listFeedSyncJobs", ({ headers }) =>
        handlers.listFeedSyncJobs(headers)
      )
      .handle("syncFeedSubscription", ({ headers, params }) =>
        handlers.syncFeedSubscription({
          headers,
          subscriptionId: params.subscriptionId,
        })
      )
      .handle("deleteFeedSubscription", ({ headers, params }) =>
        handlers.deleteFeedSubscription({
          headers,
          subscriptionId: params.subscriptionId,
        })
      )
      .handle("updateFeedSubscription", ({ headers, params, payload }) =>
        handlers.updateFeedSubscription({
          headers,
          subscriptionId: params.subscriptionId,
          payload,
        })
      )
  )
