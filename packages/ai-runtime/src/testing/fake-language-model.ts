import { Effect, Layer, Stream } from "effect"
import { AiError, LanguageModel, Response } from "effect/unstable/ai"

export type FakeLanguageModelHandler = (
  prompt: LanguageModel.ProviderOptions
) => Effect.Effect<unknown, AiError.AiError>

/** Official LanguageModel fake: structured objects still pass through Effect Schema decoding. */
export const makeFakeLanguageModelLayer = (
  handler: FakeLanguageModelHandler
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        handler(options).pipe(
          Effect.map((value) => [
            Response.makePart("text", { text: JSON.stringify(value) }),
          ])
        ),
      streamText: () => Stream.empty,
    })
  )
