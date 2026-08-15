import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** セッション解決。ブラウザのCookieから actor を決める。 */
export const sessionGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "session", (group) =>
    group.handle("resolveSession", ({ headers }) =>
      handlers.resolveSession(headers)
    )
  )
