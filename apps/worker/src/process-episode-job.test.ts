import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LocalStore } from "@news-podcast/adapters/db/local"
import { VoicevoxProviderError } from "@news-podcast/adapters/voicevox"
import { PodcastAgentError } from "@news-podcast/adapters/openai-agent"
import type { AudioStore, ObjectStore } from "@news-podcast/application"
import {
  noopObservability,
  type Observability,
  type SpanOptions,
} from "@news-podcast/observability"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  EPISODE_EXECUTION_POLICY,
  EpisodeProcessor,
  validateExecutionPolicy,
} from "./process-episode-job.js"

const directories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("bounded episode processing", () => {
  it("rejects execution policies that can outlive their safety boundaries", () => {
    expect(() =>
      validateExecutionPolicy({
        ...EPISODE_EXECUTION_POLICY,
        heartbeatMs: 21_000,
      })
    ).toThrow("Heartbeat")
    expect(() =>
      validateExecutionPolicy({
        ...EPISODE_EXECUTION_POLICY,
        maximumScriptCharacters: 6_001,
      })
    ).toThrow("storage constraints")
  })

  it("renews the lease while synthesis runs for more than 60 seconds", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-10T00:00:00.000Z") })
    const { store, leased } = await createLeasedJob("long-synthesis")
    const processor = new EpisodeProcessor({
      store,
      audio: memoryAudioStore(),
      agent: { run: () => Promise.resolve(draft("短い台本です。".repeat(20))) },
      speech: {
        synthesize: () =>
          new Promise((resolve) => setTimeout(() => resolve(wave()), 65_000)),
      },
      voice: { characterName: "ずんだもん" },
    })

    const processing = processor.process(leased)
    await vi.advanceTimersByTimeAsync(66_000)
    await processing

    expect(store.getJob("owner-1", leased.id)).toMatchObject({
      status: "succeeded",
      attempt: 1,
    })
    store.close()
  })

  it("aborts active provider work after cancellation", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-10T00:00:00.000Z") })
    const { store, leased } = await createLeasedJob("cancel-active")
    let aborted = false
    const processor = new EpisodeProcessor({
      store,
      audio: memoryAudioStore(),
      agent: {
        run: () => Promise.resolve(draft("停止対象の台本です。".repeat(20))),
      },
      speech: {
        synthesize: (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true
                reject(signal.reason)
              },
              { once: true }
            )
          }),
      },
      voice: { characterName: "ずんだもん" },
    })

    const processing = processor.process(leased)
    await vi.advanceTimersByTimeAsync(1)
    expect(store.cancelJob("owner-1", leased.id)).toBe("canceled")
    await vi.advanceTimersByTimeAsync(1_000)
    await processing

    expect(aborted).toBe(true)
    expect(store.getJob("owner-1", leased.id)?.status).toBe("canceled")
    store.close()
  })

  it("reuses the verified draft and completed WAV chunks after retry", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-10T00:00:00.000Z") })
    const traceContext = {
      traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      traceState: "vendor=value",
    }
    const { store, leased } = await createLeasedJob(
      "resume-chunks",
      traceContext
    )
    const objects = memoryObjectStore()
    const rootSpanOptions: Array<SpanOptions | undefined> = []
    const observability: Observability = {
      ...noopObservability,
      withSpan: async (name, _attributes, operation, options) => {
        if (name === "episode.process") rootSpanOptions.push(options)
        return operation()
      },
    }
    const agent = vi
      .fn()
      .mockResolvedValue(draft(`${"あ".repeat(500)}。${"い".repeat(100)}。`))
    const synthesized: string[] = []
    let failOnce = true
    const processor = new EpisodeProcessor({
      store,
      objects,
      audio: memoryAudioStore(),
      agent: { run: agent },
      speech: {
        synthesize: ({ text }) => {
          synthesized.push(text)
          if (synthesized.length === 2 && failOnce) {
            failOnce = false
            throw new VoicevoxProviderError("temporary failure")
          }
          return Promise.resolve(wave())
        },
      },
      voice: { characterName: "ずんだもん" },
      observability,
    })

    await processor.process(leased)
    expect(store.getJob("owner-1", leased.id)?.status).toBe("retrying")

    await vi.advanceTimersByTimeAsync(5_001)
    const retried = store.leaseNext(new Date())!
    await processor.process(retried)

    expect(agent).toHaveBeenCalledOnce()
    expect(synthesized).toHaveLength(3)
    expect(synthesized.filter((text) => text.startsWith("あ"))).toHaveLength(1)
    expect(store.getJob("owner-1", leased.id)).toMatchObject({
      status: "succeeded",
      attempt: 2,
    })
    expect(rootSpanOptions).toEqual([
      { link: traceContext },
      { link: traceContext },
    ])
    store.close()
  })

  it("terminalizes a permanent provider failure on attempt four", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-10T00:00:00.000Z") })
    const { store, leased } = await createLeasedJob("four-attempt-limit")
    const processor = new EpisodeProcessor({
      store,
      audio: memoryAudioStore(),
      agent: { run: () => Promise.resolve(draft("失敗する台本です。")) },
      speech: {
        synthesize: () =>
          Promise.reject(new VoicevoxProviderError("provider unavailable")),
      },
      voice: { characterName: "ずんだもん" },
    })

    let current = leased
    for (const delay of [5_001, 30_001, 120_001, 0]) {
      await processor.process(current)
      if (delay > 0) {
        await vi.advanceTimersByTimeAsync(delay)
        current = store.leaseNext(new Date())!
      }
    }

    expect(store.getJob("owner-1", leased.id)).toMatchObject({
      status: "failed",
      attempt: 4,
      failure: { code: "attempt-limit-exceeded" },
    })
    expect(store.leaseNext(new Date())).toBeUndefined()
    store.close()
  })

  it("does not persist OpenAI provider details in the public job failure", async () => {
    const { store, leased } = await createLeasedJob("sanitize-agent-error")
    const processor = new EpisodeProcessor({
      store,
      audio: memoryAudioStore(),
      agent: {
        run: () =>
          Promise.reject(
            new PodcastAgentError(
              "OpenAI rejected field secret_provider_detail",
              false
            )
          ),
      },
      speech: { synthesize: () => Promise.resolve(wave()) },
      voice: { characterName: "ずんだもん" },
    })

    await processor.process(leased)

    expect(store.getJob("owner-1", leased.id)).toMatchObject({
      status: "failed",
      failure: {
        code: "pipeline-input-invalid",
        message: "Podcast generation failed",
        retryable: false,
      },
    })
    expect(JSON.stringify(store.getJob("owner-1", leased.id))).not.toContain(
      "secret_provider_detail"
    )
    store.close()
  })
})

async function createLeasedJob(
  key: string,
  traceContext?: { readonly traceParent: string; readonly traceState?: string }
) {
  const directory = mkdtempSync(join(tmpdir(), "bounded-processing-"))
  directories.push(directory)
  const store = new LocalStore(join(directory, "app.sqlite"))
  const created = await store.create({
    ownerId: "owner-1",
    idempotencyKey: key,
    requestHash: key,
    trigger: "manual",
    feedIds: [],
    ...(traceContext ? { traceContext } : {}),
  })
  return { store, leased: store.leaseNext(new Date())!, created }
}

function draft(script: string) {
  return {
    title: "テスト番組",
    script,
    sourceUrls: [new URL("https://example.com/news")],
  }
}

function memoryAudioStore(): AudioStore {
  return {
    put: (_ownerId, episodeId, audio) =>
      Promise.resolve({
        key: `${episodeId}.wav`,
        byteLength: audio.byteLength,
      }),
    createAccessUrl: () => Promise.reject(new Error("not implemented")),
  }
}

function memoryObjectStore(): ObjectStore {
  const values = new Map<string, { body: Uint8Array; contentType: string }>()
  return {
    put: (input) => {
      input.signal?.throwIfAborted()
      values.set(input.key, {
        body: input.body,
        contentType: input.contentType,
      })
      return Promise.resolve({
        key: input.key,
        byteLength: input.body.byteLength,
        contentType: input.contentType,
      })
    },
    get: (key, signal) => {
      signal?.throwIfAborted()
      const value = values.get(key)
      return Promise.resolve(
        value
          ? {
              body: value.body,
              contentType: value.contentType,
              byteLength: value.body.byteLength,
            }
          : null
      )
    },
    delete: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

function wave(): Uint8Array {
  const result = new Uint8Array(46)
  const view = new DataView(result.buffer)
  result.set(new TextEncoder().encode("RIFF"), 0)
  view.setUint32(4, result.length - 8, true)
  result.set(new TextEncoder().encode("WAVEfmt "), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true)
  view.setUint32(28, 16_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  result.set(new TextEncoder().encode("data"), 36)
  view.setUint32(40, 2, true)
  return result
}
