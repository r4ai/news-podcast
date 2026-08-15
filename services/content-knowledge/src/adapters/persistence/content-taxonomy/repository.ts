import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
} from "../../../application/content-taxonomy.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeArticleTags } from "./article-tags.js"
import { makeTagVocabulary } from "./tag-vocabulary.js"

/**
 * タグ語彙と記事タグ付けの合成点。
 */
export const createContentTaxonomy = (
  database: ContentKnowledgeDatabase
): Effect.Effect<ContentTaxonomyRepository, ContentTaxonomyError> =>
  Effect.sync(() =>
    deepFreeze({
      ...makeTagVocabulary(database),
      ...makeArticleTags(database),
    } satisfies ContentTaxonomyRepository)
  )
