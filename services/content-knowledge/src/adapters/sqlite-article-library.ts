import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ArticleLibraryError,
  ArticleLibraryRepository,
} from "../application/article-library.js"
import { makeArticleState } from "./article-library/article-state.js"
import { makeFacets } from "./article-library/facets.js"
import { articleLibrarySchema, failure } from "./article-library/query.js"
import { makeReading } from "./article-library/reading.js"
import type { SqlitePort } from "./sqlite-port.js"

/**
 * 記事ライブラリの合成点。読み出し・状態更新・件数集計を1つのリポジトリに束ねる。
 * 状態更新は所有確認のために読み出し側の`find`を借りる。
 */

export const createSqliteArticleLibrary = (
  database: SqlitePort
): Effect.Effect<ArticleLibraryRepository, ArticleLibraryError> =>
  Effect.try({
    try: () => database.execute(articleLibrarySchema),
    catch: () => failure("Patch"),
  }).pipe(
    Effect.map(() => {
      const reading = makeReading(database)
      return deepFreeze({
        ...reading,
        ...makeArticleState(database, reading.find),
        ...makeFacets(database),
      } satisfies ArticleLibraryRepository)
    })
  )
