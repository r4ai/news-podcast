import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** フィードカタログの検索。 */
export const feedsGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "feeds", (group) =>
    group
      .handle("listFeeds", ({ headers, query }) =>
        handlers.listFeeds({
          headers,
          ...(query.q === undefined ? {} : { q: query.q }),
        })
      )
      .handle("registerFeed", ({ headers, payload }) =>
        handlers.registerFeed({ headers, payload })
      )
  )
