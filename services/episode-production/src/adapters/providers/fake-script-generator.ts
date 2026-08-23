import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  GeneratedScript,
  ScriptGenerator,
} from "../../application/ports/script-generator.js"

const TITLE = "ローカル検証ニュース"

/** Deterministic local provider used by development and observability flows. */
export const makeFakeScriptGenerator = (): ScriptGenerator =>
  deepFreeze({
    generate: ({ sources }): Effect.Effect<GeneratedScript, never> => {
      const firstTitle = sources[0]?.title.trim() || "記事"
      return Effect.succeed(
        deepFreeze({
          title: TITLE,
          script: `これはローカル検証用のfake providerが生成した台本です。${firstTitle.slice(0, 100)}を確認しました。`,
          sourceIndexes: sources.map((_, index) => index),
        })
      )
    },
  })
