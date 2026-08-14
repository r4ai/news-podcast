#!/usr/bin/env node

import { createServer } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { performance } from "node:perf_hooks"

const profiles = new Set([
  "normal",
  "slow",
  "timeout",
  "http-429",
  "http-5xx",
  "malformed",
  "incomplete",
  "invalid-audio",
  "mixed",
])

const mixedFaults = [
  "slow",
  "timeout",
  "http-429",
  "http-5xx",
  "malformed",
  "incomplete",
  "invalid-audio",
]

const positiveInteger = (value, fallback) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const probability = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback
}

const normalizeProfile = (value) => {
  const profile = String(value ?? "normal").trim()
  return profiles.has(profile) ? profile : "normal"
}

const createRandom = (seed) => {
  let value = seed >>> 0
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

export const createProviderState = (input = {}) => {
  const seed = positiveInteger(input.seed ?? process.env.FAULT_SEED, 1)
  return {
    kind: input.kind ?? process.env.PROVIDER_KIND ?? "openai",
    controlToken:
      input.controlToken ?? process.env.LOADTEST_FAKE_CONTROL_TOKEN ?? "",
    profile: normalizeProfile(input.profile ?? process.env.FAULT_PROFILE),
    faultRate: probability(
      input.faultRate ?? process.env.FAULT_RATE,
      0.1
    ),
    delayMs: positiveInteger(
      input.delayMs ?? process.env.FAULT_DELAY_MS,
      750
    ),
    timeoutMs: positiveInteger(
      input.timeoutMs ?? process.env.FAULT_TIMEOUT_MS,
      4_000
    ),
    seed,
    requestCount: 0,
    faultCount: 0,
    statusCounts: new Map(),
    routeCounts: new Map(),
    totalDurationMs: 0,
    random: createRandom(seed),
  }
}

export const chooseFault = (state) => {
  if (state.profile !== "mixed") return state.profile
  if (state.random() >= state.faultRate) return "normal"
  return mixedFaults[Math.floor(state.random() * mixedFaults.length)]
}

export const setProviderProfile = (state, input) => {
  const profile = normalizeProfile(input?.profile)
  const seed = positiveInteger(input?.seed, state.seed)
  state.profile = profile
  state.faultRate = probability(input?.faultRate, state.faultRate)
  state.delayMs = positiveInteger(input?.delayMs, state.delayMs)
  state.timeoutMs = positiveInteger(input?.timeoutMs, state.timeoutMs)
  state.seed = seed
  state.random = createRandom(seed)
  return profileSnapshot(state)
}

export const profileSnapshot = (state) => ({
  kind: state.kind,
  profile: state.profile,
  faultRate: state.faultRate,
  delayMs: state.delayMs,
  timeoutMs: state.timeoutMs,
  seed: state.seed,
})

export const authorizeControlRequest = (state, request) => {
  const expected = Buffer.from(state.controlToken)
  const actual = Buffer.from(request.headers["x-loadtest-admin-token"] ?? "")
  return (
    expected.length > 0 &&
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  )
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const readBody = async (request, maximumBytes = 2 * 1_024 * 1_024) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > maximumBytes) throw new Error("request body too large")
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

const send = (response, status, body, contentType = "application/json") => {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": bytes.byteLength,
    "cache-control": "no-store",
  })
  response.end(bytes)
}

const sendJson = (response, status, body) =>
  send(response, status, JSON.stringify(body))

const record = (state, path, status, durationMs, fault) => {
  state.totalDurationMs += durationMs
  state.routeCounts.set(path, (state.routeCounts.get(path) ?? 0) + 1)
  state.statusCounts.set(String(status), (state.statusCounts.get(String(status)) ?? 0) + 1)
  if (fault !== "normal") state.faultCount += 1
}

const metrics = (state) => ({
  ...profileSnapshot(state),
  requests: state.requestCount,
  faults: state.faultCount,
  averageDurationMs:
    state.requestCount === 0 ? 0 : state.totalDurationMs / state.requestCount,
  routes: Object.fromEntries(state.routeCounts),
  statuses: Object.fromEntries(state.statusCounts),
})

const extractSources = (body) => {
  try {
    const input = Array.isArray(body?.input) ? body.input : []
    const user = input.find((item) => item?.role === "user")
    const payload = JSON.parse(String(user?.content ?? "{}"))
    const sources = Array.isArray(payload.sources) ? payload.sources : []
    return sources
      .filter((source) => typeof source?.url === "string")
      .map((source) => ({
        title: String(source.title ?? "負荷テスト記事"),
        url: source.url,
      }))
  } catch {
    return []
  }
}

const openAiResponse = (body, fault) => {
  const sources = extractSources(body)
  const sourceUrls = sources.map((source) => source.url)
  const validPayload = {
    title: "負荷テストニュース",
    script: `負荷テスト用Fake OpenAIが${sources[0]?.title ?? "記事"}を要約しました。`,
    source_urls: sourceUrls.length > 0 ? sourceUrls : ["https://example.com/loadtest"],
  }

  if (fault === "malformed") return "{invalid-json"
  if (fault === "incomplete") {
    return JSON.stringify({ status: "incomplete", output: [] })
  }
  if (fault === "invalid-audio") {
    return JSON.stringify({
      status: "completed",
      output: [{ content: [{ type: "refusal" }] }],
    })
  }
  return JSON.stringify({
    status: "completed",
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify(
              fault === "http-5xx"
                ? { ...validPayload, source_urls: ["https://attacker.invalid/source"] }
                : validPayload
            ),
          },
        ],
      },
    ],
  })
}

const audioQuery = {
  accent_phrases: [],
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  outputSamplingRate: 24_000,
  outputStereo: false,
  kana: "テスト",
}

const createWav = (sampleCount = 1) => {
  const bytes = Buffer.alloc(44 + sampleCount)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8, "ascii")
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24_000, 24)
  bytes.writeUInt32LE(48_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36, "ascii")
  bytes.writeUInt32LE(sampleCount, 40)
  bytes.fill(1, 44)
  return bytes
}

export { createWav }

const voicevoxPayload = (path, fault) => {
  if (path === "/speakers") {
    if (fault === "malformed") return "{invalid-json"
    return JSON.stringify([
      {
        name: "ずんだもん",
        styles: [{ name: "ノーマル", id: 3 }],
      },
    ])
  }
  if (path === "/audio_query") {
    if (fault === "malformed") return "{invalid-json"
    return JSON.stringify(audioQuery)
  }
  if (fault === "malformed") return "{invalid-json"
  if (fault === "invalid-audio") return Buffer.from("not-a-wave")
  if (fault === "incomplete") return createWav(2 * 1_024 * 1_024)
  return createWav()
}

const providerRoute = (kind, pathname) => {
  if (kind === "openai") return pathname.endsWith("/responses")
  return ["/speakers", "/audio_query", "/synthesis"].includes(pathname)
}

const handleProvider = async (state, request, response, url) => {
  const started = performance.now()
  const path = url.pathname
  const requestNumber = (state.requestCount += 1)
  const fault = chooseFault(state)

  try {
    if (!providerRoute(state.kind, path)) {
      record(state, path, 404, performance.now() - started, fault)
      sendJson(response, 404, { error: "not found" })
      return
    }

    if (fault === "slow") await wait(state.delayMs)
    if (fault === "timeout") await wait(state.timeoutMs)
    if (fault === "http-429") {
      record(state, path, 429, performance.now() - started, fault)
      response.setHeader("retry-after", "1")
      sendJson(response, 429, { error: "rate limited", requestNumber })
      return
    }
    if (fault === "http-5xx") {
      record(state, path, 503, performance.now() - started, fault)
      sendJson(response, 503, { error: "provider unavailable", requestNumber })
      return
    }

    let body = ""
    if (request.method !== "GET") body = await readBody(request)
    const parsedBody = body === "" ? undefined : JSON.parse(body)
    const payload =
      state.kind === "openai"
        ? openAiResponse(parsedBody, fault)
        : voicevoxPayload(path, fault)
    const contentType =
      state.kind === "voicevox" && path === "/synthesis"
        ? "audio/wav"
        : "application/json"
    record(state, path, 200, performance.now() - started, fault)
    send(response, 200, payload, contentType)
  } catch (error) {
    record(state, path, 500, performance.now() - started, fault)
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "provider failure",
    })
  }
}

export const createProviderServer = (state) =>
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://provider-fake")
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok", ...profileSnapshot(state) })
      return
    }
    if (request.method === "GET" && url.pathname === "/metrics") {
      sendJson(response, 200, metrics(state))
      return
    }
    if (request.method === "POST" && url.pathname === "/control/profile") {
      if (!authorizeControlRequest(state, request)) {
        sendJson(response, 401, { error: "control authentication required" })
        return
      }
      try {
        const input = JSON.parse(await readBody(request, 8_192))
        sendJson(response, 200, setProviderProfile(state, input))
      } catch {
        sendJson(response, 400, { error: "invalid profile" })
      }
      return
    }
    await handleProvider(state, request, response, url)
  })

const main = async () => {
  const state = createProviderState()
  const server = createProviderServer(state)
  const port = positiveInteger(process.env.PORT, 8080)
  server.listen(port, "0.0.0.0", () => {
    console.log(`provider-fake kind=${state.kind} port=${port}`)
  })
  const shutdown = () =>
    server.close(() => process.exit(0))
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
}

if (process.argv[1]?.endsWith("/server.mjs")) await main()
