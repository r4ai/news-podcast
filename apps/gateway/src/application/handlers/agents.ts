import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** エージェント実行の監査と記憶の管理。 */
export const agentsGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "agents", (group) =>
    group
      .handle("listAgentInstances", ({ headers }) =>
        handlers.listAgentInstances(headers)
      )
      .handle("getAgentRun", ({ headers, params }) =>
        handlers.getAgentRun({ headers, runId: params.runId })
      )
      .handle("streamAgentRunEvents", ({ headers, params, query }) => {
        const headerSequence = Number(headers["last-event-id"])
        return handlers.streamAgentRunEvents({
          headers: {
            ...(headers.authorization === undefined
              ? {}
              : { authorization: headers.authorization }),
            ...(headers.cookie === undefined ? {} : { cookie: headers.cookie }),
            ...(headers.traceparent === undefined
              ? {}
              : { traceparent: headers.traceparent }),
          },
          runId: params.runId,
          afterSequence:
            Number.isSafeInteger(headerSequence) && headerSequence >= 0
              ? headerSequence
              : (query.lastEventId ?? 0),
        })
      })
      .handle("listAgentMemories", ({ headers, params }) =>
        handlers.listAgentMemories({
          headers,
          agentInstanceId: params.agentInstanceId,
        })
      )
      .handle("createAgentMemory", ({ headers, params, payload }) =>
        handlers.createAgentMemory({
          headers,
          agentInstanceId: params.agentInstanceId,
          payload,
        })
      )
      .handle("approveAgentMemory", ({ headers, params }) =>
        handlers.approveAgentMemory({
          headers,
          agentInstanceId: params.agentInstanceId,
          memoryId: params.memoryId,
        })
      )
      .handle("deleteAgentMemory", ({ headers, params }) =>
        handlers.deleteAgentMemory({
          headers,
          agentInstanceId: params.agentInstanceId,
          memoryId: params.memoryId,
        })
      )
  )
