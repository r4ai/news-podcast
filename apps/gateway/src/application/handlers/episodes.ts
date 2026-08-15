import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** 完成したエピソードの一覧・取得と、音声への一時アクセス発行。 */
export const episodesGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "episodes", (group) =>
    group
      .handle("listEpisodes", ({ headers, query }) =>
        handlers.listEpisodes({
          headers,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        })
      )
      .handle("getEpisode", ({ headers, params }) =>
        handlers.getEpisode({ headers, episodeId: params.episodeId })
      )
      .handle("createAudioAccess", ({ headers, params }) =>
        handlers.createAudioAccess({
          headers,
          episodeId: params.episodeId,
        })
      )
  )
