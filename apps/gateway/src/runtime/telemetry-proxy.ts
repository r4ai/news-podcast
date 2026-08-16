const telemetryPaths = new Map([
  ["/v1/telemetry/traces", "/v1/traces"],
  ["/v1/telemetry/logs", "/v1/logs"],
  ["/v1/telemetry/metrics", "/v1/metrics"],
])

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

const blockedResponseHeaders = new Set([...hopByHopHeaders, "set-cookie"])

const otlpRequestHeaders = new Set([
  "accept",
  "content-encoding",
  "content-type",
])

const forwardRequestHeaders = (source: Headers) => {
  const headers = new Headers()
  source.forEach((value, name) => {
    if (otlpRequestHeaders.has(name.toLowerCase())) headers.set(name, value)
  })
  return headers
}

const forwardResponseHeaders = (source: Headers) => {
  const headers = new Headers()
  source.forEach((value, name) => {
    if (!blockedResponseHeaders.has(name.toLowerCase()))
      headers.set(name, value)
  })
  return headers
}

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
    void reader.cancel(error)
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

/** Proxies browser-relative OTLP requests to the Collector without exposing its origin. */
export const makeGatewayTelemetryProxy =
  (input: {
    readonly upstream: URL
    readonly timeoutMillis: number
    readonly maximumRequestBytes: number
    readonly maximumResponseBytes: number
    readonly fetch: typeof globalThis.fetch
    readonly next: (request: Request) => Promise<Response>
  }) =>
  async (request: Request): Promise<Response> => {
    const source = new URL(request.url)
    const upstreamPath = telemetryPaths.get(source.pathname)
    if (upstreamPath === undefined) return input.next(request)
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { allow: "POST" },
      })

    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), input.timeoutMillis)
    try {
      const requestLength = Number(request.headers.get("content-length") ?? "0")
      if (requestLength > input.maximumRequestBytes) throw requestTooLarge
      const body = await readBounded(
        request.body,
        input.maximumRequestBytes,
        controller.signal
      )
      const target = new URL(upstreamPath + source.search, input.upstream)
      const response = await input.fetch(target, {
        method: "POST",
        headers: forwardRequestHeaders(request.headers),
        body,
        redirect: "manual",
        signal: controller.signal,
      } as RequestInit)
      const stated = Number(response.headers.get("content-length") ?? "0")
      if (stated > input.maximumResponseBytes) throw responseTooLarge
      const responseBody = await readBounded(
        response.body,
        input.maximumResponseBytes,
        controller.signal
      ).catch((error) => {
        if (error === requestTooLarge) throw responseTooLarge
        throw error
      })
      return new Response(responseBody.byteLength === 0 ? null : responseBody, {
        status: response.status,
        headers: forwardResponseHeaders(response.headers),
      })
    } catch (error) {
      if (error === requestTooLarge)
        return Response.json(
          { title: "Payload Too Large", status: 413 },
          { status: 413 }
        )
      if (error === responseTooLarge)
        return Response.json(
          { title: "Collector response too large", status: 502 },
          { status: 502 }
        )
      return Response.json(
        { title: "Telemetry Collector unavailable", status: 503 },
        { status: 503 }
      )
    } finally {
      clearTimeout(deadline)
    }
  }
