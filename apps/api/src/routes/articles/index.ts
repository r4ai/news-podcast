// 記事の一覧・状態変更・アーカイブ本文配信・AI補助・タグ付けを扱う。
// 注意: 本番の登録順は AI enrichment（enrich-queue）を挟むため、
// 実際の登録は routes/index.ts が個々のregistrarを直接importして順序を決める。
// このファイルはArticlesリソース単位でのテスト・参照用に自然な並びで再エクスポートする。
import type { RouteRegistrar } from "../../http/context.js"
import { registerArticleArchive } from "./archive.js"
import { registerArticleAsset } from "./asset.js"
import { registerEnrichArticle } from "./enrich.js"
import { registerArticleFacets } from "./facets.js"
import { registerGetArticle } from "./get.js"
import { registerListArticles } from "./list.js"
import { registerArticleMarkdown } from "./markdown.js"
import { registerPatchArticle } from "./patch.js"
import { registerPutArticleTags } from "./put-tags.js"
import { registerBulkArticleState } from "./bulk-state.js"

export const articlesRegistrars: readonly RouteRegistrar[] = [
  registerListArticles,
  registerArticleFacets,
  registerGetArticle,
  registerPatchArticle,
  registerBulkArticleState,
  registerArticleMarkdown,
  registerArticleArchive,
  registerEnrichArticle,
  registerArticleAsset,
  registerPutArticleTags,
]

export {
  registerListArticles,
  registerArticleFacets,
  registerGetArticle,
  registerPatchArticle,
  registerBulkArticleState,
  registerArticleMarkdown,
  registerArticleArchive,
  registerEnrichArticle,
  registerArticleAsset,
  registerPutArticleTags,
}
