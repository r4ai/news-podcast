import type { Prompt } from "effect/unstable/ai"

import type { GenerationCandidate } from "../../../../application/ports/article-catalog.js"
import type { InterestProfile } from "../../../../domain/interest-profile.js"

export const articleSelectionPrompt = (input: {
  readonly interestProfile: InterestProfile
  readonly candidates: readonly GenerationCandidate[]
}): Prompt.RawInput => [
  {
    role: "system",
    content:
      "関心プロファイルに基づきPodcastで扱う記事を重要順に1〜20件選んでください。候補にないIDは返さず、除外関心を優先して避け、媒体と話題の多様性も考慮してください。",
  },
  {
    role: "user",
    content: JSON.stringify({
      interestProfile: input.interestProfile,
      candidates: input.candidates.map((candidate) => ({
        articleId: candidate.articleId,
        title: candidate.title,
        sourceName: candidate.sourceName,
        ...(candidate.publishedAt === undefined
          ? {}
          : { publishedAt: candidate.publishedAt }),
        ...(candidate.summary === undefined
          ? {}
          : { summary: candidate.summary }),
        tags: candidate.tags,
      })),
    }),
  },
]
