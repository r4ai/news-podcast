import type { LookupAddress } from "node:dns"
import { lookup } from "node:dns/promises"
import { isIP, type LookupFunction } from "node:net"

import ipaddr from "ipaddr.js"
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici"

const MAX_REDIRECTS = 5
const MAX_CONCURRENT_PINNED_HOSTNAMES = 1_024

export type AddressResolver = (
  hostname: string
) => Promise<readonly LookupAddress[]>

export interface NodeSafeFetcher {
  readonly fetch: typeof fetch
  close(): Promise<void>
}

/**
 * Creates the Content context's outbound HTTP boundary. DNS validation and the
 * socket connection share one pinned result, so a later DNS rebind cannot
 * redirect the connection to a private address.
 */
export const createNodeSafeFetcher = (
  resolver: AddressResolver = resolveAddresses
): NodeSafeFetcher => {
  const pins = createPinnedLookup()
  const dispatcher = new Agent({ connect: { lookup: pins.lookup } })
  const safeFetch = (async (
    input: URL | RequestInfo,
    init?: RequestInit
  ): Promise<Response> => {
    let resolved = await resolveSafePublicUrl(requestUrl(input), resolver)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const releasePin = pins.pin(resolved.url.hostname, resolved.addresses)
      let response: Response
      try {
        response = (await undiciFetch(resolved.url, {
          ...(init as unknown as UndiciRequestInit),
          dispatcher,
          redirect: "manual",
        })) as unknown as Response
      } finally {
        releasePin()
      }
      if (!isRedirect(response.status)) return response
      const location = response.headers.get("location")
      if (location === null) return response
      resolved = await resolveSafePublicUrl(
        new URL(location, resolved.url),
        resolver
      )
    }
    throw new Error("Too many redirects")
  }) as typeof fetch

  return Object.freeze({ fetch: safeFetch, close: () => dispatcher.close() })
}

/** Testable redirect implementation; production uses the DNS-pinned variant. */
export const createSafeFetcher = (
  baseFetcher: typeof fetch = fetch,
  resolver: AddressResolver = resolveAddresses
): typeof fetch =>
  (async (input: URL | RequestInfo, init?: RequestInit) => {
    let url = await assertSafePublicUrl(requestUrl(input), resolver)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await baseFetcher(url, { ...init, redirect: "manual" })
      if (!isRedirect(response.status)) return response
      const location = response.headers.get("location")
      if (location === null) return response
      url = await assertSafePublicUrl(new URL(location, url), resolver)
    }
    throw new Error("Too many redirects")
  }) as typeof fetch

export const assertSafePublicUrl = async (
  value: string | URL,
  resolver: AddressResolver = resolveAddresses
): Promise<URL> => (await resolveSafePublicUrl(value, resolver)).url

export const createPinnedLookup = (): {
  readonly pin: (
    hostname: string,
    addresses: readonly LookupAddress[]
  ) => () => void
  readonly lookup: LookupFunction
} => {
  const pinned = new Map<string, Map<symbol, readonly LookupAddress[]>>()
  return {
    pin: (hostname, addresses) => {
      const key = normalizeHostname(hostname)
      let active = pinned.get(key)
      if (active === undefined) {
        if (pinned.size >= MAX_CONCURRENT_PINNED_HOSTNAMES)
          throw new Error("Too many concurrently pinned hostnames")
        active = new Map()
        pinned.set(key, active)
      }
      const token = Symbol(key)
      active.set(token, [...addresses])
      return () => {
        const current = pinned.get(key)
        current?.delete(token)
        if (current?.size === 0) pinned.delete(key)
      }
    },
    lookup: (hostname, options, callback) => {
      const active = pinned.get(normalizeHostname(hostname))
      const addresses = active ? ([...active.values()].at(-1) ?? []) : []
      const candidates =
        typeof options.family === "number" && options.family !== 0
          ? addresses.filter(({ family }) => family === options.family)
          : addresses
      const selected = candidates[0]
      if (selected === undefined) {
        const error = new Error(
          `No validated address is pinned for ${hostname}`
        ) as NodeJS.ErrnoException
        error.code = "ENOTFOUND"
        callback(error, "")
      } else if (options.all) {
        callback(null, [...candidates])
      } else {
        callback(null, selected.address, selected.family)
      }
    },
  }
}

const resolveSafePublicUrl = async (
  value: string | URL,
  resolver: AddressResolver
): Promise<{
  readonly url: URL
  readonly addresses: readonly LookupAddress[]
}> => {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Only HTTP and HTTPS URLs are allowed")
  if (url.username !== "" || url.password !== "")
    throw new Error("URL credentials are not allowed")
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost"))
    throw new Error("Local addresses are not allowed")

  const hostname = normalizeHostname(url.hostname)
  const family = isIP(hostname)
  const addresses = family
    ? [{ address: hostname, family }]
    : await resolver(hostname)
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublic(address))
  )
    throw new Error("Private or reserved addresses are not allowed")
  return { url, addresses }
}

const requestUrl = (input: URL | RequestInfo): string | URL =>
  input instanceof Request ? input.url : input

const isRedirect = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308

const isPublic = (address: string): boolean => {
  try {
    return ipaddr.parse(address).range() === "unicast"
  } catch {
    return false
  }
}

const normalizeHostname = (hostname: string): string => {
  const normalized = hostname.toLowerCase()
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized
}

const resolveAddresses = (
  hostname: string
): Promise<readonly LookupAddress[]> => lookup(hostname, { all: true })
