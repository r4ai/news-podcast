import {
  InvalidBrowserTelemetry,
  sanitizeBrowserTelemetry,
  type BrowserSignal,
} from "./browser-telemetry.js"
import { makeTelemetryAdmission } from "./telemetry-admission.js"

const telemetryPaths = new Map<string, BrowserSignal>([
  ["/v1/telemetry/traces", "traces"],
  ["/v1/telemetry/logs", "logs"],
  ["/v1/telemetry/metrics", "metrics"],
])

const requestTooLarge = Object.freeze({ _tag: "RequestTooLarge" as const })
const deadlineExceeded = Object.freeze({ _tag: "DeadlineExceeded" as const })
const responseTooLarge = Object.freeze({ _tag: "ResponseTooLarge" as const })

const readBounded = async (
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal
) => {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(deadlineExceeded)
    else
      signal.addEventListener("abort", () => reject(deadlineExceeded), {
        once: true,
      })
  })
  try {
    while (true) {
      const result = await Promise.race([reader.read(), aborted])
      if (result.done) break
      size += result.value.byteLength
      if (size > maximumBytes) throw requestTooLarge
      chunks.push(result.value)
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export type GatewayRequestHandler = (
  request: Request,
  peerAddress?: string
) => Promise<Response>

/** Session and resource admission precede parsing, then only rebuilt browser data is exported. */
export const makeGatewayTelemetryProxy = (input: {
  readonly upstream: URL
  readonly timeoutMillis: number
  readonly maximumRequestBytes: number
  readonly maximumResponseBytes: number
  readonly fetch: typeof globalThis.fetch
  readonly resolveOwner: (
    request: Request,
    signal: AbortSignal
  ) => Promise<string | undefined>
  readonly now?: () => number
  readonly onOutcome?: (status: number) => void
  readonly next: GatewayRequestHandler
}): GatewayRequestHandler => {
  const admission = makeTelemetryAdmission(input.now ?? Date.now)
  return async (request, peerAddress) => {
    const signal = telemetryPaths.get(new URL(request.url).pathname)
    if (signal === undefined) return input.next(request, peerAddress)
    const respond = (status: number, title: string) => {
      input.onOutcome?.(status)
      return Response.json(
        { title, status },
        { status, headers: status === 429 ? { "retry-after": "60" } : {} }
      )
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } })
    if (!admission.enter(peerAddress ?? "unknown"))
      return respond(429, "Telemetry rate limit exceeded")
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), input.timeoutMillis)
    const abort = () => controller.abort()
    request.signal.addEventListener("abort", abort, { once: true })
    if (request.signal.aborted) controller.abort()
    try {
      if (request.headers.get("sec-fetch-site") === "cross-site")
        return respond(403, "Cross-site telemetry forbidden")
      const owner = await Promise.race([
        input.resolveOwner(request, controller.signal),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(deadlineExceeded)
          else
            controller.signal.addEventListener(
              "abort",
              () => reject(deadlineExceeded),
              { once: true }
            )
        }),
      ])
      if (owner === undefined) return respond(401, "Session required")
      if (!admission.owner(owner))
        return respond(429, "Telemetry rate limit exceeded")
      if (
        request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return respond(415, "OTLP JSON required")
      const encoding = (request.headers.get("content-encoding") ?? "identity")
        .trim()
        .toLowerCase()
      if (encoding !== "identity" && encoding !== "gzip")
        return respond(415, "Unsupported telemetry encoding")
      const wireLimit = Math.min(input.maximumRequestBytes, 262_144)
      if (Number(request.headers.get("content-length") ?? "0") > wireLimit)
        throw requestTooLarge
      const wire = await readBounded(request.body, wireLimit, controller.signal)
      let decoded = wire
      if (encoding === "gzip") {
        const stream = new ReadableStream<BufferSource>({
          start(c) {
            c.enqueue(new Uint8Array(wire))
            c.close()
          },
        }).pipeThrough(new DecompressionStream("gzip"))
        try {
          decoded = await readBounded(
            stream,
            Math.min(input.maximumRequestBytes, 1_048_576, wire.length * 20),
            controller.signal
          )
        } catch (error) {
          if (error === requestTooLarge || controller.signal.aborted)
            throw error
          throw new InvalidBrowserTelemetry()
        }
      }
      let payload: unknown
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(decoded)
        )
      } catch {
        throw new InvalidBrowserTelemetry()
      }
      const body = JSON.stringify(sanitizeBrowserTelemetry(signal, payload))
      const response = await input.fetch(
        new URL(`/v1/${signal}`, input.upstream),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          redirect: "manual",
          signal: controller.signal,
        }
      )
      if (
        Number(response.headers.get("content-length") ?? "0") >
        input.maximumResponseBytes
      ) {
        void response.body?.cancel().catch(() => undefined)
        throw responseTooLarge
      }
      const responseBody = await readBounded(
        response.body,
        input.maximumResponseBytes,
        controller.signal
      ).catch((error) => {
        if (error === requestTooLarge) throw responseTooLarge
        throw error
      })
      input.onOutcome?.(response.status)
      return new Response(responseBody.byteLength === 0 ? null : responseBody, {
        status: response.status,
        headers: { "content-type": "application/json" },
      })
    } catch (error) {
      if (error instanceof InvalidBrowserTelemetry)
        return respond(400, "Invalid browser telemetry")
      if (error === requestTooLarge) return respond(413, "Payload Too Large")
      if (error === responseTooLarge)
        return respond(502, "Collector response too large")
      return respond(503, "Telemetry Collector unavailable")
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener("abort", abort)
      if (!request.bodyUsed) void request.body?.cancel().catch(() => undefined)
      admission.leave()
    }
  }
}
