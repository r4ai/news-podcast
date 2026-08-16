import {
  applyAiRuntimePolicy,
  makeOpenAiLanguageModelLayer,
} from "@news-podcast/ai-runtime"
import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, type Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"

import type {
  ArticleSelectionFailure,
  ArticleSelector,
} from "../../../../application/generation-planning.js"
import { ArticleIdSchema } from "../../../../domain/article.js"
import { articleSelectionPrompt } from "./prompt.js"
import { ArticleSelectionPayloadSchema } from "./schema.js"

export type OpenAiArticleSelectorConfig = Readonly<{
  readonly apiUrl: URL
  readonly apiKey: string
  readonly model: string
  readonly requestTimeoutMillis: number
}>

export type OpenAiArticleSelectorDependencies = Readonly<{
  readonly languageModelLayer?: Layer.Layer<LanguageModel.LanguageModel>
  readonly fetcher?: typeof fetch
}>

const failure = (): ArticleSelectionFailure =>
  deepFreeze({ _tag: "ArticleSelectionFailed", reason: "ProviderFailure" })

export const makeOpenAiArticleSelector = (
  config: OpenAiArticleSelectorConfig,
  dependencies: OpenAiArticleSelectorDependencies = {}
): ArticleSelector => {
  const languageModelLayer =
    dependencies.languageModelLayer ??
    makeOpenAiLanguageModelLayer(
      {
        apiKey: config.apiKey,
        apiUrl: config.apiUrl.toString(),
        model: config.model,
        requestTimeoutMillis: config.requestTimeoutMillis,
        maximumResponseBytes: 262_144,
        maximumOutputTokens: 2_048,
      },
      dependencies.fetcher === undefined
        ? {}
        : { fetcher: dependencies.fetcher }
    )
  return deepFreeze({
    model: config.model,
    select: (input) =>
      applyAiRuntimePolicy(
        LanguageModel.generateObject({
          objectName: "article_selection_v1",
          prompt: articleSelectionPrompt(input),
          schema: ArticleSelectionPayloadSchema,
        }).pipe(Effect.provide(languageModelLayer)),
        { requestTimeoutMillis: config.requestTimeoutMillis }
      ).pipe(
        Effect.mapError(failure),
        Effect.flatMap((response) =>
          Effect.forEach(response.value.selectedArticleIds, (articleId) =>
            parse(ArticleIdSchema)(articleId)
          ).pipe(Effect.mapError(failure), Effect.map(deepFreeze))
        )
      ),
  })
}
