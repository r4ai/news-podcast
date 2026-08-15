import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import { retryProvider } from "../../../application/retry-provider.js"
import type { SpeechSynthesizer } from "../../../application/ports/speech-synthesizer.js"
import type { ProviderFailure } from "../../../domain/provider-reliability.js"
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
  const synthesize: SpeechSynthesizer["synthesize"] = (request) => {
    const operation = (): Effect.Effect<Uint8Array, ProviderFailure> => {
      const chunks = splitSpeech(
        request.text,
        config.maximumTextCharactersPerRequest
      )
      if (chunks.length === 0) return Effect.fail(malformed())
      return Effect.gen(function* () {
        const styleId = yield* resolveStyleId(config, fetcher, request.signal)
        const waves: Uint8Array[] = []
        for (const chunk of chunks) {
          waves.push(
            yield* synthesizeChunk(
              config,
              fetcher,
              chunk,
              styleId,
              request.signal
            )
          )
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
          // VOICEVOX user_dict is process-global; claiming per-owner application here is unsafe.
          "reading_dictionary.provider_applied": false,
        },
      })
    )
  }
  return deepFreeze({ synthesize })
}
