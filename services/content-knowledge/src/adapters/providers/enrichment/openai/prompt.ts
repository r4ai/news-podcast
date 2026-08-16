import type { Prompt } from "effect/unstable/ai"

import type { EnrichmentProviderInput } from "../../../../domain/enrichment.js"

export const enrichmentPrompt = (
  input: EnrichmentProviderInput
): Prompt.RawInput => [
  {
    role: "system",
    content:
      "記事本文だけを根拠に要約と関心度を評価してください。tagsにはtagVocabulary内の値だけを使い、新規候補はsuggestedTagsへ入れてください。",
  },
  {
    role: "user",
    content: JSON.stringify({
      articleId: input.articleId,
      title: input.title,
      markdown: input.markdown,
      interestProfile: input.interestProfile,
      tagVocabulary: input.tagVocabulary,
    }),
  },
]
