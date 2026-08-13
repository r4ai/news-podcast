import { createHmac, timingSafeEqual } from "node:crypto"

import type { BetterAuthSessionApi } from "../adapters/better-auth-session-reader.js"
import type { DevBearerAuthConfig } from "../infrastructure/unsafe/better-auth.js"

const cookieName = "news_podcast_dev"
const jsonLimit = 8_192
const bodyLimitExceeded = Object.freeze({ _tag: "BodyLimitExceeded" as const })
const bodyDeadlineExceeded = Object.freeze({
  _tag: "BodyDeadlineExceeded" as const,
})
const readBody = async (
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  timeoutMillis: number
) => {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timeout!: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(bodyDeadlineExceeded), timeoutMillis)
  })
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline])
      if (result.done) break
      size += result.value.byteLength
      if (size > maximumBytes) throw bodyLimitExceeded
      chunks.push(result.value)
    }
  } catch (error) {
    void reader.cancel(error)
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const equal = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const cookieValue = (ownerId: string, secret: string) => {
  const owner = Buffer.from(ownerId).toString("base64url")
  const signature = createHmac("sha256", secret)
    .update(ownerId)
    .digest("base64url")
  return `${owner}.${signature}`
}

const cookieOwner = (headers: Headers, secret: string): string | undefined => {
  const raw = headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
  if (raw === undefined) return undefined
  const [encoded, signature] = raw.split(".")
  if (encoded === undefined || signature === undefined) return undefined
  const ownerId = Buffer.from(encoded, "base64url").toString()
  const expected = createHmac("sha256", secret)
    .update(ownerId)
    .digest("base64url")
  return equal(signature, expected) ? ownerId : undefined
}

export const makeIdentityAuthHttpHandler = (
  input: {
    readonly betterAuthHandler: (request: Request) => Promise<Response>
    readonly sessionApi: BetterAuthSessionApi
    readonly devAuth: DevBearerAuthConfig
    readonly secret: string
  },
  options: { readonly bodyTimeoutMillis: number } = { bodyTimeoutMillis: 5_000 }
) => {
  const sessionApi: BetterAuthSessionApi = {
    getSession: (request) => {
      const ownerId = input.devAuth.enabled
        ? cookieOwner(request.headers, input.secret)
        : undefined
      return ownerId === undefined
        ? input.sessionApi.getSession(request)
        : Promise.resolve({ user: { id: ownerId } })
    },
  }

  const handler = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    if (path.startsWith("/api/auth/")) return input.betterAuthHandler(request)
    if (path === "/api/dev/logout" && request.method === "POST") {
      if (!input.devAuth.enabled) return new Response(null, { status: 404 })
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      })
    }
    if (path === "/api/dev/login" && request.method === "POST") {
      if (!input.devAuth.enabled) return new Response(null, { status: 404 })
      const statedLength = Number(request.headers.get("content-length") ?? "0")
      if (statedLength > jsonLimit)
        return Response.json(
          { title: "Payload Too Large", status: 413 },
          { status: 413 }
        )
      let bytes: Uint8Array
      try {
        bytes = await readBody(
          request.body,
          jsonLimit,
          options.bodyTimeoutMillis
        )
      } catch (error) {
        return Response.json(
          {
            title:
              error === bodyLimitExceeded
                ? "Payload Too Large"
                : "Request Timeout",
            status: error === bodyLimitExceeded ? 413 : 408,
          },
          { status: error === bodyLimitExceeded ? 413 : 408 }
        )
      }
      let password: unknown
      try {
        password = (
          JSON.parse(new TextDecoder().decode(bytes)) as { password?: unknown }
        ).password
      } catch {
        return Response.json(
          { title: "Bad Request", status: 400 },
          { status: 400 }
        )
      }
      if (typeof password !== "string" || !equal(password, input.devAuth.token))
        return Response.json(
          { title: "Unauthorized", status: 401 },
          { status: 401 }
        )
      return Response.json(
        { ownerId: input.devAuth.userId },
        {
          headers: {
            "set-cookie": `${cookieName}=${cookieValue(input.devAuth.userId, input.secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          },
        }
      )
    }
    return new Response(null, { status: 404 })
  }
  return Object.freeze({ handler, sessionApi })
}
