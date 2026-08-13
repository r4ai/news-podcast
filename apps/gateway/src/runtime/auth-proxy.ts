const proxied = (path: string) =>
  (path.startsWith("/api/auth/") && path !== "/api/auth/state") ||
  path === "/api/dev/login" ||
  path === "/api/dev/logout"
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
])
const filteredHeaders = (source: Headers) => {
  const headers = new Headers()
  source.forEach((value, name) => {
    if (
      name.toLowerCase() !== "set-cookie" &&
      !hopByHop.has(name.toLowerCase())
    )
      headers.append(name, value)
  })
  for (const cookie of source.getSetCookie())
    headers.append("set-cookie", cookie)
  return headers
}

const bodyLimitExceeded = Object.freeze({ _tag: "BodyLimitExceeded" as const })
const bodyDeadlineExceeded = Object.freeze({
  _tag: "BodyDeadlineExceeded" as const,
})
const upstreamBodyLimitExceeded = Object.freeze({
  _tag: "UpstreamBodyLimitExceeded" as const,
})
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
    if (signal.aborted) reject(bodyDeadlineExceeded)
    else
      signal.addEventListener("abort", () => reject(bodyDeadlineExceeded), {
        once: true,
      })
  })
  try {
    while (true) {
      const result = await Promise.race([reader.read(), aborted])
      if (result.done) break
      size += result.value.byteLength
      if (size > maximumBytes) throw bodyLimitExceeded
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

/** Fixed-upstream auth proxy with finite time and response-size budgets. */
export const makeGatewayAuthProxy =
  (input: {
    readonly upstream: URL
    readonly timeoutMillis: number
    readonly maximumResponseBytes: number
    readonly fetch: typeof globalThis.fetch
    readonly next: (request: Request) => Promise<Response>
  }) =>
  async (request: Request): Promise<Response> => {
    const source = new URL(request.url)
    if (!proxied(source.pathname)) return input.next(request)
    const target = new URL(source.pathname + source.search, input.upstream)
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), input.timeoutMillis)
    try {
      const requestLength = Number(request.headers.get("content-length") ?? "0")
      if (requestLength > input.maximumResponseBytes)
        return Response.json(
          { title: "Payload Too Large", status: 413 },
          { status: 413 }
        )
      const requestBody =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await readBounded(
              request.body,
              input.maximumResponseBytes,
              controller.signal
            )
      const response = await input.fetch(target, {
        method: request.method,
        headers: filteredHeaders(request.headers),
        body: requestBody,
        redirect: "manual",
        signal: controller.signal,
      } as RequestInit)
      const stated = Number(response.headers.get("content-length") ?? "0")
      if (stated > input.maximumResponseBytes)
        return Response.json(
          { title: "Upstream response too large", status: 502 },
          { status: 502 }
        )
      const body = await readBounded(
        response.body,
        input.maximumResponseBytes,
        controller.signal
      ).catch((error) => {
        if (error === bodyLimitExceeded) throw upstreamBodyLimitExceeded
        throw error
      })
      return new Response(body.byteLength === 0 ? null : body, {
        status: response.status,
        headers: filteredHeaders(response.headers),
      })
    } catch (error) {
      if (error === bodyLimitExceeded)
        return Response.json(
          { title: "Payload Too Large", status: 413 },
          { status: 413 }
        )
      if (error === upstreamBodyLimitExceeded)
        return Response.json(
          { title: "Upstream response too large", status: 502 },
          { status: 502 }
        )
      return Response.json(
        { title: "Identity unavailable", status: 503 },
        { status: 503 }
      )
    } finally {
      clearTimeout(deadline)
    }
  }
