import type { Prompt } from "effect/unstable/ai"

import type { ScriptGenerationRequest } from "../../../application/ports/script-generator.js"
import { MAXIMUM_SOURCE_MARKDOWN_CHARACTERS } from "./schema.js"

const truncate = (value: string, maximumCharacters: number): string =>
  Array.from(value).slice(0, maximumCharacters).join("")

export const scriptPrompt = (
  request: ScriptGenerationRequest
): Prompt.RawInput => [
  {
    role: "system",
    content:
      "提供された記事だけを根拠に、日本語ニュースPodcastのタイトルと台本を作成してください。source_idsには実際に使用した入力記事のsource_idだけを含めてください。",
  },
  {
    role: "user",
    content: JSON.stringify({
      ...(request.interestProfile === undefined
        ? {}
        : { interest_profile: request.interestProfile }),
      sources: request.sources.map((source, index) => ({
        source_id: `source-${index + 1}`,
        title: source.title,
        markdown: truncate(source.markdown, MAXIMUM_SOURCE_MARKDOWN_CHARACTERS),
      })),
    }),
  },
]
