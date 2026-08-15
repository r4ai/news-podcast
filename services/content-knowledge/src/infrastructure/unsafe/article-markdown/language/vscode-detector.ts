import { createRequire } from "node:module"
import type * as LanguageDetection from "@vscode/vscode-languagedetection"

import type { LanguageCandidate, LanguageDetector } from "../core/contracts.js"

export const MINIMUM_DETECTION_CHARACTERS = 80
export const MINIMUM_DETECTION_CONFIDENCE = 0.35
export const MINIMUM_DETECTION_MARGIN = 0.2

const require = createRequire(import.meta.url)
const { ModelOperations } =
  require("@vscode/vscode-languagedetection") as typeof LanguageDetection

let model: InstanceType<typeof ModelOperations> | undefined

const runModel: LanguageDetector = async (source) => {
  model ??= new ModelOperations({
    minContentSize: MINIMUM_DETECTION_CHARACTERS,
  })
  return model.runModel(source)
}

export const selectDetectedLanguage = (
  source: string,
  candidates: readonly LanguageCandidate[]
): string | undefined => {
  if (source.replace(/\s/g, "").length < MINIMUM_DETECTION_CHARACTERS)
    return undefined
  const first = candidates[0]
  if (!first || first.confidence < MINIMUM_DETECTION_CONFIDENCE)
    return undefined
  const secondConfidence = candidates[1]?.confidence ?? 0
  if (first.confidence - secondConfidence < MINIMUM_DETECTION_MARGIN)
    return undefined
  return first.languageId
}

export const detectLanguage = async (
  source: string,
  detector: LanguageDetector = runModel
): Promise<string | undefined> => {
  if (source.replace(/\s/g, "").length < MINIMUM_DETECTION_CHARACTERS)
    return undefined
  try {
    return selectDetectedLanguage(source, await detector(source))
  } catch {
    return undefined
  }
}
