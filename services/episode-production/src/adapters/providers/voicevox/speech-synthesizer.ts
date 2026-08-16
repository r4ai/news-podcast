import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import { retryProvider } from "../../../application/retry-provider.js"
import { applyReadingDictionary } from "../../../application/apply-reading-dictionary.js"
import type { SpeechSynthesizer } from "../../../application/ports/speech-synthesizer.js"
import { resolveStyleId, splitSpeech, synthesizeChunk } from "./api.js"
import type {
  VoicevoxSpeechSynthesizerConfig,
  VoicevoxSpeechSynthesizerDependencies,
} from "./config.js"
import { failWhenAborted, malformed } from "./http.js"
import { mergeWaves } from "./wave.js"

/**
 * VOICEVOXによる音声合成アダプタの合成点。
 * 上限文字数で分割 → 逐次合成 → 1本のWAVへ結合、という流れだけをここに置く。
 */

export type {
  VoicevoxSpeechSynthesizerConfig,
  VoicevoxSpeechSynthesizerDependencies,
}

export const makeVoicevoxSpeechSynthesizer = (
  config: VoicevoxSpeechSynthesizerConfig,
  dependencies: VoicevoxSpeechSynthesizerDependencies = {}
): SpeechSynthesizer => {
  const fetcher = dependencies.fetcher ?? fetch
  const synthesize: SpeechSynthesizer["synthesize"] = (request, onProgress) => {
    const applied = applyReadingDictionary(
      request.text,
      request.dictionarySnapshot?.entries ?? []
    )
    const operation = () => {
      const chunks = splitSpeech(
        applied.text,
        config.maximumTextCharactersPerRequest
      )
      if (chunks.length === 0) return Effect.fail(malformed())
      return Effect.gen(function* () {
        const styleId = yield* resolveStyleId(config, fetcher, request.signal)
        const waves: Uint8Array[] = []
        for (const [index, chunk] of chunks.entries()) {
          waves.push(
            yield* synthesizeChunk(
              config,
              fetcher,
              chunk,
              styleId,
              request.signal
            )
          )
          if (onProgress !== undefined) {
            yield* onProgress({ completed: index + 1, total: chunks.length })
          }
        }
        const merged = mergeWaves(waves, config.maximumAudioBytes)
        return merged ?? (yield* Effect.fail(malformed()))
      })
    }
    const retried = dependencies.retryRuntime
      ? retryProvider(operation, config.retryPolicy, dependencies.retryRuntime)
      : retryProvider(operation, config.retryPolicy)
    const bounded = request.signal
      ? Effect.raceFirst(retried, failWhenAborted(request.signal))
      : retried
    return bounded.pipe(
      Effect.withSpan("episodeProduction.voicevoxSynthesize", {
        kind: "client",
        attributes: {
          "gen_ai.operation.name": "speech_synthesis",
          "reading_dictionary.snapshot_fingerprint":
            request.dictionarySnapshot?.fingerprint ?? "none",
          "reading_dictionary.entry_count":
            request.dictionarySnapshot?.entries.length ?? 0,
          "reading_dictionary.replacement_count": applied.replacementCount,
          "reading_dictionary.application_mode": "text_replacement",
        },
      })
    )
  }
  return deepFreeze({ synthesize })
}
