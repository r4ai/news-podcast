import type { Prompt } from "effect/unstable/ai"

import { MAXIMUM_SCRIPT_CHARACTERS } from "./schema.js"

export const readingTermPrompt = (script: string): Prompt.RawInput => [
  {
    role: "system",
    content:
      "日本語Podcast台本から音声合成が誤読しやすい表記だけを抽出してください。英略語、英数字を含む技術用語、製品名、企業名、人名、地名、読みが複数ある固有名詞を対象にし、台本に実在する表記をsurface、全角カタカナ読みをreading、アクセント位置をaccent_typeとして最大30件返してください。",
  },
  {
    role: "user",
    content: Array.from(script).slice(0, MAXIMUM_SCRIPT_CHARACTERS).join(""),
  },
]
