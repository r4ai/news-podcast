import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ArticleLibraryError,
  ArticleLibraryRepository,
} from "../../../application/article-library.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeFacets } from "./facets.js"
import { makeReading } from "./reading.js"
import { makeArticleState } from "./state.js"

/**
 * 記事ライブラリの合成点。読み出し・状態更新・件数集計を1つのリポジトリに束ねる。
 * 状態更新は所有確認のために読み出し側の`find`を借りる。
 */
export const createArticleLibrary = (
  database: ContentKnowledgeDatabase
): Effect.Effect<ArticleLibraryRepository, ArticleLibraryError> =>
  Effect.sync(() => {
    const reading = makeReading(database)
    return deepFreeze({
      ...reading,
      ...makeArticleState(database, reading.find),
      ...makeFacets(database),
    } satisfies ArticleLibraryRepository)
  })
