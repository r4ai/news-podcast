import { createHmac, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"

import { LocalAudioStore } from "@news-podcast/adapters/audio/local"
import type { LocalStore } from "@news-podcast/adapters/db/local"

const DEV_COOKIE = "news_podcast_dev"

export function createDevAuth(input: {
  readonly enabled: boolean
  readonly secret: string
  readonly password: string
  readonly ownerId: string
  readonly store: LocalStore
}) {
  const sign = (value: string) =>
    createHmac("sha256", input.secret).update(value).digest("base64url")

  return {
    async login(request: Request): Promise<Response> {
      if (!input.enabled) return new Response(null, { status: 404 })
      const body = (await request.json().catch(() => null)) as {
        password?: unknown
      } | null
      const supplied =
        typeof body?.password === "string"
          ? Buffer.from(body.password)
          : Buffer.alloc(0)
      const expectedPassword = Buffer.from(input.password)
      if (
        supplied.length !== expectedPassword.length ||
        !timingSafeEqual(supplied, expectedPassword)
      ) {
        return Response.json(
          { title: "Unauthorized", status: 401 },
          { status: 401 }
        )
      }
      input.store.ensureDefaultSubscriptions(input.ownerId)
      const value = `${Buffer.from(input.ownerId).toString("base64url")}.${sign(input.ownerId)}`
      return Response.json(
        { ownerId: input.ownerId },
        {
          headers: {
            "Set-Cookie": `${DEV_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          },
        }
      )
    },
    logout(): Promise<Response> {
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: {
            "Set-Cookie": `${DEV_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
          },
        })
      )
    },
    owner(request: Request): string | null {
      if (!input.enabled) return null
      const raw = request.headers
        .get("cookie")
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${DEV_COOKIE}=`))
        ?.slice(DEV_COOKIE.length + 1)
      if (!raw) return null
      const [encoded, signature] = raw.split(".")
      if (!encoded || !signature) return null
      const ownerId = Buffer.from(encoded, "base64url").toString()
      const expected = Buffer.from(sign(ownerId))
      const actual = Buffer.from(signature)
      return expected.length === actual.length &&
        timingSafeEqual(expected, actual)
        ? ownerId
        : null
    },
  }
}

export function createAudioAccess(input: {
  readonly secret: string
  readonly baseUrl: string
  readonly store: LocalStore
  readonly directory: string
}) {
  const audio = new LocalAudioStore(input.directory)
  const signature = (payload: string) =>
    createHmac("sha256", input.secret).update(payload).digest("base64url")

  return {
    issue(ownerId: string, episodeId: string) {
      if (!input.store.getAudio(ownerId, episodeId))
        return Promise.resolve(undefined)
      const expiresAt = new Date(Date.now() + 5 * 60_000)
      const payload = Buffer.from(
        JSON.stringify({ ownerId, episodeId, expiresAt: expiresAt.getTime() })
      ).toString("base64url")
      const token = `${payload}.${signature(payload)}`
      return Promise.resolve({
        url: new URL(`/v1/audio/${token}`, input.baseUrl).href,
        expiresAt: expiresAt.toISOString(),
      })
    },
    async serve(token: string, range?: string): Promise<Response> {
      const [payload, provided] = token.split(".")
      if (!payload || !provided || signature(payload) !== provided) {
        return new Response(null, { status: 404 })
      }
      const value = JSON.parse(
        Buffer.from(payload, "base64url").toString()
      ) as {
        ownerId: string
        episodeId: string
        expiresAt: number
      }
      if (value.expiresAt < Date.now())
        return new Response(null, { status: 404 })
      const stored = input.store.getAudio(value.ownerId, value.episodeId)
      if (!stored) return new Response(null, { status: 404 })
      const bytes = await readFile(audio.resolve(stored.key))
      const bounds = parseRange(range, bytes.length)
      if (!bounds) {
        return new Response(bytes, {
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(bytes.length),
            "Content-Type": "audio/wav",
          },
        })
      }
      const body = bytes.subarray(bounds.start, bounds.end + 1)
      return new Response(body, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(body.length),
          "Content-Range": `bytes ${bounds.start}-${bounds.end}/${bytes.length}`,
          "Content-Type": "audio/wav",
        },
      })
    },
  }
}

function parseRange(value: string | undefined, length: number) {
  const match = value?.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return undefined
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : length - 1
  return start <= end && end < length ? { start, end } : undefined
}
