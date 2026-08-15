import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** 関心プロファイルと生成スケジュール。 */
export const personalizationGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "personalization", (group) =>
    group
      .handle("getSettings", ({ headers }) => handlers.getSettings(headers))
      .handle("updateSettings", ({ headers, payload }) =>
        handlers.updateSettings({ headers, payload })
      )
      .handle("listTags", ({ headers }) => handlers.listTags(headers))
      .handle("createTag", ({ headers, payload }) =>
        handlers.createTag({ headers, payload })
      )
      .handle("deleteTag", ({ headers, params }) =>
        handlers.deleteTag({ headers, tagId: params.tagId })
      )
      .handle("listTagSuggestions", ({ headers }) =>
        handlers.listTagSuggestions(headers)
      )
      .handle("promoteTagSuggestion", ({ headers, payload }) =>
        handlers.promoteTagSuggestion({ headers, payload })
      )
      .handle("listReadingDictionary", ({ headers }) =>
        handlers.listReadingDictionary(headers)
      )
      .handle("createReadingDictionary", ({ headers, payload }) =>
        handlers.createReadingDictionary({ headers, payload })
      )
      .handle("updateReadingDictionary", ({ headers, params, payload }) =>
        handlers.updateReadingDictionary({ headers, id: params.id, payload })
      )
      .handle("deleteReadingDictionary", ({ headers, params }) =>
        handlers.deleteReadingDictionary({ headers, id: params.id })
      )
      .handle("getEnrichQueue", ({ headers }) =>
        handlers.getEnrichQueue(headers)
      )
      .handle("enrichReprocess", ({ headers }) =>
        handlers.enrichReprocess(headers)
      )
      .handle("enrichResetDaily", ({ headers }) =>
        handlers.enrichResetDaily(headers)
      )
  )
