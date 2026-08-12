import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArticleId } from "../domain/article.js"
import type { OwnerId } from "../domain/subscription.js"
import type {
  ArticleCatalog,
  ArticleCatalogError,
  MarkdownObjectError,
  MarkdownObjectReader,
} from "./article-catalog-ports.js"

export type MaterializeSelection = DeepReadonly<
  | { readonly _tag: "Automatic" }
  | { readonly _tag: "Selected"; readonly articleIds: readonly ArticleId[] }
>
export type MaterializedArticle = DeepReadonly<{
  readonly articleId: ArticleId
  readonly snapshotId: string
  readonly title: string
  readonly url: string
  readonly markdown: string
  readonly publishedAt?: string
}>
export type MaterializeResult = DeepReadonly<
  | {
      readonly _tag: "Materialized"
      readonly articles: readonly [
        MaterializedArticle,
        ...MaterializedArticle[],
      ]
    }
  | { readonly _tag: "NoArticles" }
  | { readonly _tag: "NotFound" }
>

export const materializeArticles =
  (ports: {
    readonly catalog: ArticleCatalog
    readonly objects: MarkdownObjectReader
  }) =>
  (input: {
    readonly ownerId: OwnerId
    readonly selection: MaterializeSelection
  }): Effect.Effect<
    MaterializeResult,
    ArticleCatalogError | MarkdownObjectError
  > => {
    const found =
      input.selection._tag === "Automatic"
        ? ports.catalog.findAutomatic(input.ownerId, 20)
        : ports.catalog.findSelected(input.ownerId, input.selection.articleIds)
    return found.pipe(
      Effect.flatMap(
        (articles): Effect.Effect<MaterializeResult, MarkdownObjectError> => {
          if (
            input.selection._tag === "Selected" &&
            articles.length !== input.selection.articleIds.length
          ) {
            return Effect.succeed<MaterializeResult>(
              deepFreeze({ _tag: "NotFound" as const })
            )
          }
          if (articles.length === 0)
            return Effect.succeed<MaterializeResult>(
              deepFreeze({ _tag: "NoArticles" as const })
            )
          return Effect.forEach(
            articles,
            (article) =>
              ports.objects.read(article.markdownKey).pipe(
                Effect.map((markdown): MaterializedArticle =>
                  deepFreeze({
                    articleId: article.articleId,
                    snapshotId: article.snapshotId,
                    title: article.title,
                    url: article.sourceUrl,
                    markdown,
                    ...(article.publishedAt === undefined
                      ? {}
                      : { publishedAt: article.publishedAt }),
                  })
                )
              ),
            { concurrency: 1 }
          ).pipe(
            Effect.map((materialized): MaterializeResult => {
              const [first, ...rest] = materialized
              return first === undefined
                ? deepFreeze({ _tag: "NoArticles" as const })
                : deepFreeze({
                    _tag: "Materialized" as const,
                    articles: [first, ...rest],
                  })
            })
          )
        }
      )
    )
  }
