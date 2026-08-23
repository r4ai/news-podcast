import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** 記事一覧・本文・状態更新・タグ付け。 */
export const articlesGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "articles", (group) =>
    group
      .handle("listArticles", ({ headers, query }) =>
        handlers.listArticles({
          headers,
          query: {
            ...(query.limit === undefined ? {} : { limit: query.limit }),
            ...(query.state === undefined ? {} : { state: query.state }),
            ...(query.includeHidden === undefined
              ? {}
              : { includeHidden: query.includeHidden }),
            ...(query.feedIds === undefined ? {} : { feedIds: query.feedIds }),
            ...(query.q === undefined ? {} : { q: query.q }),
            ...(query.sort === "newest" || query.sort === "oldest"
              ? { sort: query.sort }
              : {}),
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          },
        })
      )
      .handle("getArticleFacets", ({ headers, query }) =>
        handlers.getArticleFacets({
          headers,
          query: {
            ...(query.includeHidden === undefined
              ? {}
              : { includeHidden: query.includeHidden }),
            ...(query.feedIds === undefined ? {} : { feedIds: query.feedIds }),
            ...(query.q === undefined ? {} : { q: query.q }),
          },
        })
      )
      .handle("getArticle", ({ headers, params }) =>
        handlers.getArticle({ headers, articleId: params.articleId })
      )
      .handle("getArticleMarkdown", ({ headers, params }) =>
        handlers.getArticleMarkdown({
          headers,
          articleId: params.articleId,
        })
      )
      .handle("getArticleReplay", ({ headers, params }) =>
        handlers.getArticleReplay({
          headers,
          snapshotId: params.snapshotId,
        })
      )
      .handle("streamArticleReplay", ({ headers, params }) =>
        handlers.streamArticleReplayObject({
          headers,
          snapshotId: params.snapshotId,
          object: { kind: "Replay" },
        })
      )
      .handle("streamArticleReplayAsset", ({ headers, params }) =>
        handlers.streamArticleReplayObject({
          headers,
          snapshotId: params.snapshotId,
          object: { kind: "Asset", assetName: params.assetName },
        })
      )
      .handle("patchArticle", ({ headers, params, payload }) =>
        handlers.patchArticle({
          headers,
          articleId: params.articleId,
          payload,
        })
      )
      .handle("bulkPatchArticles", ({ headers, payload }) =>
        handlers.bulkPatchArticles({ headers, payload })
      )
      .handle("archiveArticle", ({ headers, params }) =>
        handlers.archiveArticle({ headers, articleId: params.articleId })
      )
      .handle("listArticleTags", ({ headers, params }) =>
        handlers.listArticleTags({ headers, articleId: params.articleId })
      )
      .handle("setArticleTags", ({ headers, params, payload }) =>
        handlers.setArticleTags({
          headers,
          articleId: params.articleId,
          payload,
        })
      )
      .handle("enrichArticle", ({ headers, params }) =>
        handlers.enrichArticle({ headers, articleId: params.articleId })
      )
  )
