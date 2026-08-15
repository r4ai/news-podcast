import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** 稼働確認。認証を要求しない唯一の面。 */
export const systemGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "system", (group) =>
    group.handle("health", handlers.health)
  )
