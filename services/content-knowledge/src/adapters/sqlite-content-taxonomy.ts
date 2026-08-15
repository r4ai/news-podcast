import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
} from "../application/content-taxonomy.js"
import { makeArticleTags } from "./content-taxonomy/article-tags.js"
import { makeTagVocabulary } from "./content-taxonomy/tag-vocabulary.js"
import { contentTaxonomySchema, failure } from "./content-taxonomy/schema.js"
import type { SqlitePort } from "./sqlite-port.js"

/**
 * タグ分類の合成点。語彙の管理と、記事へのタグ付けを1つのリポジトリに束ねる。
 */

export { contentTaxonomySchema }

export const createSqliteContentTaxonomy = (
  database: SqlitePort
): Effect.Effect<ContentTaxonomyRepository, ContentTaxonomyError> =>
  Effect.try({
    try: () => database.execute(contentTaxonomySchema),
    catch: () => failure("CreateTag"),
  }).pipe(
    Effect.map(() =>
      deepFreeze({
        ...makeTagVocabulary(database),
        ...makeArticleTags(database),
      } satisfies ContentTaxonomyRepository)
    )
  )
