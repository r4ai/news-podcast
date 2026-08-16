import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"

import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import type { ProviderRetryPolicy } from "../../../domain/provider-reliability.js"
import {
  makeVoicevoxSpeechSynthesizer,
  type VoicevoxSpeechSynthesizerDependencies,
} from "./speech-synthesizer.js"

const retryPolicy: ProviderRetryPolicy = {
  maximumAttempts: 2,
  maximumElapsedMillis: 10_000,
  baseDelayMillis: 25,
  maximumDelayMillis: 2_000,
}

const speakers = [
  {
    name: "ずんだもん",
    speaker_uuid: "provider-only",
    styles: [
      { name: "ノーマル", id: 3, type: "talk" },
      { name: "あまあま", id: 1, type: "talk" },
    ],
    version: "0.0.0",
  },
]

const audioQuery = {
  accent_phrases: [
    {
      moras: [
        {
          text: "テ",
          consonant: "t",
          consonant_length: 0.1,
          vowel: "e",
          vowel_length: 0.1,
          pitch: 5,
        },
      ],
      accent: 1,
      pause_mora: null,
      is_interrogative: false,
    },
  ],
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  pauseLength: null,
  pauseLengthScale: 1,
  outputSamplingRate: 24_000,
  outputStereo: false,
  kana: "テ",
}

const uint32 = (bytes: Uint8Array, offset: number, value: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    true
  )

const wav = (samples: readonly number[] = [1, 2, 3, 4]): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length)
  bytes.set(Buffer.from("RIFF"), 0)
  uint32(bytes, 4, bytes.length - 8)
  bytes.set(Buffer.from("WAVEfmt "), 8)
  uint32(bytes, 16, 16)
  const view = new DataView(bytes.buffer)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  uint32(bytes, 24, 24_000)
  uint32(bytes, 28, 48_000)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(Buffer.from("data"), 36)
  uint32(bytes, 40, samples.length)
  bytes.set(samples, 44)
  return bytes
}

type ObservedRequest = Readonly<{
  method: string | undefined
  url: string | undefined
  body: string
}>

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
  requestNumber: number
) => void

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const json = (response: ServerResponse, body: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

const defaultHandler: Handler = (request, response) => {
  const path = new URL(request.url!, "http://test").pathname
  if (path === "/speakers") return json(response, speakers)
  if (path === "/audio_query") return json(response, audioQuery)
  if (path === "/synthesis") {
    response.writeHead(200, { "content-type": "audio/wav" })
    response.end(wav())
    return
  }
  response.writeHead(404).end()
}

const startServer = async (handler: Handler = defaultHandler) => {
  const requests: ObservedRequest[] = []
  let requestNumber = 0
  let notifyRequest = () => {}
  const firstRequest = new Promise<void>((resolve) => {
    notifyRequest = resolve
  })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      requests.push({ method: request.method, url: request.url, body })
      requestNumber += 1
      notifyRequest()
      handler(request, response, body, requestNumber)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: new URL(`http://127.0.0.1:${address.port}/`),
    requests,
    firstRequest,
  }
}

const makeSynthesizer = (
  baseUrl: URL,
  input: {
    readonly styleName?: string
    readonly requestTimeoutMillis?: number
    readonly maximumAudioBytes?: number
    readonly maximumTextCharactersPerRequest?: number
    readonly runtime?: VoicevoxSpeechSynthesizerDependencies["retryRuntime"]
  } = {}
) =>
  makeVoicevoxSpeechSynthesizer(
    {
      baseUrl,
      characterName: "ずんだもん",
      ...(input.styleName ? { styleName: input.styleName } : {}),
      requestTimeoutMillis: input.requestTimeoutMillis ?? 1_000,
      maximumAudioBytes: input.maximumAudioBytes ?? 1_024 * 1_024,
      maximumTextCharactersPerRequest:
        input.maximumTextCharactersPerRequest ?? 500,
      retryPolicy,
    },
    { ...(input.runtime ? { retryRuntime: input.runtime } : {}) }
  )

const synthesize = (
  synthesizer: ReturnType<typeof makeSynthesizer>,
  text = "境界をテストします。",
  signal?: AbortSignal,
  dictionarySnapshot?: Parameters<
    ReturnType<typeof makeSynthesizer>["synthesize"]
  >[0]["dictionarySnapshot"]
) =>
  synthesizer.synthesize({
    text,
    ...(signal ? { signal } : {}),
    ...(dictionarySnapshot ? { dictionarySnapshot } : {}),
  })

describe("VOICEVOX SpeechSynthesizer HTTP boundary", () => {
  it("resolves the configured style, posts a strict query, and returns WAV bytes", async () => {
    const fake = await startServer()

    const bytes = await Effect.runPromise(
      synthesize(makeSynthesizer(fake.baseUrl, { styleName: "あまあま" }))
    )

    expect(bytes).toEqual(wav())
    expect(fake.requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "POST",
    ])
    expect(fake.requests[1]!.url).toContain("speaker=1")
    expect(fake.requests[1]!.url).toContain(
      `text=${encodeURIComponent("境界をテストします。")}`
    )
    expect(fake.requests[2]!.url).toContain("speaker=1")
    expect(JSON.parse(fake.requests[2]!.body)).toEqual(audioQuery)
  })

  it("applies the immutable owner dictionary before creating the audio query", async () => {
    const fake = await startServer()

    await Effect.runPromise(
      synthesize(makeSynthesizer(fake.baseUrl), "OpenAIのニュース", undefined, {
        ownerId: "339cdfd2-349c-44ed-814c-3b3c387bd624" as never,
        fingerprint: "a".repeat(64) as never,
        entries: [
          {
            surface: "OpenAI" as never,
            reading: "オープンエーアイ" as never,
            accentType: 0 as never,
          },
        ],
      })
    )

    expect(fake.requests[1]!.url).toContain(
      `text=${encodeURIComponent("オープンエーアイのニュース")}`
    )
  })

  it.each([
    [
      "speakers",
      [
        {
          name: "ずんだもん",
          styles: [{ name: "ノーマル", id: "secret-invalid-id" }],
        },
      ],
    ],
    ["audio query", { ...audioQuery, speedScale: "secret-invalid-scale" }],
  ])(
    "rejects a malformed %s response without retaining its body",
    async (kind, malformed) => {
      const fake = await startServer((request, response) => {
        const path = new URL(request.url!, "http://test").pathname
        if (path === "/speakers") {
          return json(response, kind === "speakers" ? malformed : speakers)
        }
        if (path === "/audio_query") return json(response, malformed)
        defaultHandler(request, response, "", 0)
      })

      const failure = await Effect.runPromise(
        Effect.flip(synthesize(makeSynthesizer(fake.baseUrl)))
      )

      expect(failure).toEqual({ _tag: "MalformedResponse" })
      expect(JSON.stringify(failure)).not.toContain("secret-invalid")
      expect(
        fake.requests.some(({ url }) => url?.startsWith("/synthesis"))
      ).toBe(false)
    }
  )

  it.each([
    ["missing RIFF/WAVE markers", new Uint8Array(44)],
    ["truncated chunk", wav().slice(0, 42)],
    ["empty audio data", wav([])],
  ])("rejects an invalid WAV: %s", async (_kind, body) => {
    const fake = await startServer((request, response) => {
      const path = new URL(request.url!, "http://test").pathname
      if (path !== "/synthesis") return defaultHandler(request, response, "", 0)
      response.writeHead(200, { "content-type": "audio/wav" })
      response.end(body)
    })

    const failure = await Effect.runPromise(
      Effect.flip(synthesize(makeSynthesizer(fake.baseUrl)))
    )

    expect(failure).toEqual({ _tag: "MalformedResponse" })
  })

  it("stops reading an oversized WAV response", async () => {
    const fake = await startServer((request, response) => {
      const path = new URL(request.url!, "http://test").pathname
      if (path !== "/synthesis") return defaultHandler(request, response, "", 0)
      response.writeHead(200, { "content-type": "audio/wav" })
      response.end(wav(new Array(200).fill(1)))
    })

    const failure = await Effect.runPromise(
      Effect.flip(
        synthesize(makeSynthesizer(fake.baseUrl, { maximumAudioBytes: 100 }))
      )
    )

    expect(failure).toEqual({ _tag: "MalformedResponse" })
  })

  it.each([
    [429, { "retry-after": "2" }, 2_000],
    [503, {}, 25],
  ] as const)(
    "retries HTTP %s under the shared bounded budget",
    async (status, headers, expectedDelay) => {
      let failed = false
      const fake = await startServer((request, response) => {
        const path = new URL(request.url!, "http://test").pathname
        if (path === "/synthesis" && !failed) {
          failed = true
          response.writeHead(status, {
            "content-type": "application/json",
            ...headers,
          })
          response.end(JSON.stringify({ error: "secret provider body" }))
          return
        }
        defaultHandler(request, response, "", 0)
      })
      const delays: number[] = []
      const synthesizer = makeSynthesizer(fake.baseUrl, {
        runtime: {
          nowMillis: () => Effect.succeed(0),
          sleep: (delay) => Effect.sync(() => delays.push(delay)),
        },
      })

      await Effect.runPromise(synthesize(synthesizer))

      expect(delays).toEqual([expectedDelay])
      expect(
        fake.requests.filter(({ url }) => url === "/speakers")
      ).toHaveLength(2)
      expect(
        fake.requests.filter(({ url }) => url?.startsWith("/synthesis"))
      ).toHaveLength(2)
    }
  )

  it("does not retry or retain a non-retryable 4xx response body", async () => {
    const fake = await startServer((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "secret provider body" }))
    })

    const failure = await Effect.runPromise(
      Effect.flip(
        synthesize(makeSynthesizer(fake.baseUrl), "secret request text")
      )
    )

    expect(failure).toEqual({ _tag: "HttpFailure", status: 400 })
    expect(JSON.stringify(failure)).not.toContain("secret")
    expect(fake.requests).toHaveLength(1)
  })

  it("classifies a request deadline and exhausts its bounded retry", async () => {
    const fake = await startServer(() => undefined)
    const synthesizer = makeSynthesizer(fake.baseUrl, {
      requestTimeoutMillis: 20,
      runtime: {
        nowMillis: () => Effect.succeed(0),
        sleep: () => Effect.void,
      },
    })

    const failure = await Effect.runPromise(
      Effect.flip(synthesize(synthesizer))
    )

    expect(failure).toEqual({
      _tag: "ProviderRetryExhausted",
      attempts: 2,
      reason: "AttemptLimit",
      lastFailure: { _tag: "Timeout" },
    })
  })

  it("cancels a hanging request without retrying", async () => {
    const fake = await startServer(() => undefined)
    const controller = new AbortController()
    const pending = Effect.runPromise(
      Effect.flip(
        synthesize(
          makeSynthesizer(fake.baseUrl),
          "cancel me",
          controller.signal
        )
      )
    )
    await fake.firstRequest

    controller.abort()

    await expect(pending).resolves.toEqual({ _tag: "Canceled" })
    expect(fake.requests).toHaveLength(1)
  })

  it("chunks long text and merges compatible WAV data under the total byte limit", async () => {
    let synthesisCount = 0
    const progress: { completed: number; total: number }[] = []
    const fake = await startServer((request, response) => {
      const path = new URL(request.url!, "http://test").pathname
      if (path !== "/synthesis") return defaultHandler(request, response, "", 0)
      synthesisCount += 1
      response.writeHead(200, { "content-type": "audio/wav" })
      response.end(wav(synthesisCount === 1 ? [1, 2] : [3, 4]))
    })

    const synthesizer = makeSynthesizer(fake.baseUrl, {
      maximumTextCharactersPerRequest: 4,
    })
    const bytes = await Effect.runPromise(
      synthesizer.synthesize({ text: "12345678" }, (reported) =>
        Effect.sync(() => progress.push(reported))
      )
    )

    expect(synthesisCount).toBe(2)
    expect(progress).toEqual([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ])
    expect(Array.from(bytes.slice(44))).toEqual([1, 2, 3, 4])
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8)
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(4)
  })
})
