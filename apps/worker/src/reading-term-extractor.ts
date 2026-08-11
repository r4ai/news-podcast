import type { OpenAiConfig } from "@news-podcast/adapters/config"

export interface ReadingTerm {
  readonly surface: string
  readonly reading: string
  readonly accentType: number
}

const MAX_SCRIPT_CHARACTERS = 20_000
const MAX_TERMS = 30
const KATAKANA_READING = /^[ァ-ヶー・＝＆＋A-Z0-9\s]+$/

/** 壊れやすい自由JSONを避け、Responses APIの構造化出力から読み候補を抽出する。 */
export async function extractReadingTerms(
  script: string,
  config: OpenAiConfig,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<readonly ReadingTerm[]> {
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content:
            "Podcast台本からVOICEVOXが誤読しやすい語を抽出してください。英略語、英数字を含む技術用語、製品名・サービス名・企業名・人名・地名、読みが複数ある固有名詞を対象にします。一般的な日本語や文脈上読みが自明な語は除外し、台本に現れる表記をsurface、自然な全角カタカナ読みをreading、VOICEVOX互換のアクセント位置をaccent_typeとして最大30件返してください。",
        },
        {
          role: "user",
          content: script.slice(0, MAX_SCRIPT_CHARACTERS),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reading_dictionary_terms",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["terms"],
            properties: {
              terms: {
                type: "array",
                maxItems: MAX_TERMS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["surface", "reading", "accent_type"],
                  properties: {
                    surface: { type: "string" },
                    reading: { type: "string" },
                    accent_type: { type: "integer", minimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
    }),
  })

  if (!response.ok) return []
  const body = (await response.json()) as {
    readonly output?: readonly {
      readonly content?: readonly {
        readonly type?: unknown
        readonly text?: unknown
      }[]
    }[]
  }
  const outputText = body.output
    ?.flatMap((output) => output.content ?? [])
    .find((content) => content.type === "output_text")?.text
  if (typeof outputText !== "string") return []

  return parseReadingTerms(outputText)
}

function parseReadingTerms(outputText: string): readonly ReadingTerm[] {
  let terms: unknown
  try {
    const payload = JSON.parse(outputText) as { readonly terms?: unknown }
    terms = payload.terms
  } catch {
    return []
  }
  if (!Array.isArray(terms)) return []

  const seen = new Set<string>()
  const result: ReadingTerm[] = []
  for (const value of terms.slice(0, MAX_TERMS)) {
    if (!isRecord(value)) continue
    const surface = normalizeSurface(value.surface)
    const reading = normalizeReading(value.reading)
    const accentType = value.accent_type
    const key = readingTermKey(surface)
    if (
      !surface ||
      surface.length > 80 ||
      !reading ||
      reading.length > 160 ||
      !KATAKANA_READING.test(reading) ||
      !Number.isInteger(accentType) ||
      (accentType as number) < 0 ||
      (accentType as number) > 100 ||
      seen.has(key)
    ) {
      continue
    }
    seen.add(key)
    result.push({ surface, reading, accentType: accentType as number })
  }
  return result
}

export function readingTermKey(surface: string): string {
  return surface.normalize("NFKC").trim().toLocaleLowerCase("ja")
}

function normalizeSurface(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : ""
}

function normalizeReading(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim()
    : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
