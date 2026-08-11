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

type AddressResolver = (hostname: string) => Promise<readonly LookupAddress[]>

export interface NodeSafeFetcher {
  readonly fetch: typeof fetch
  close(): Promise<void>
}

export interface NodeSafeFetcherOptions {
  /**
   * 宛先URLごとにトレース伝播を制御するフック。
   * observabilityのcomposition rootが、allowlist外のURLへW3C Trace Contextが
   * 漏れないよう注入する（ADR-0017）。未指定なら常に素通し。
   */
  readonly propagate?: (
    url: URL,
    execute: () => Promise<Response>
  ) => Promise<Response>
}

export function createNodeSafeFetcher(
  options: NodeSafeFetcherOptions = {},
  resolver: AddressResolver = resolveAddresses
): NodeSafeFetcher {
  const pins = createPinnedLookup()
  const dispatcher = new Agent({ connect: { lookup: pins.lookup } })
  const safeFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    let resolved = await resolveSafePublicUrl(
      input instanceof Request ? input.url : String(input),
      resolver
    )
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const releasePin = pins.pin(resolved.url.hostname, resolved.addresses)
      let response: Response
      try {
        const requestInit: UndiciRequestInit = {
          ...(init as unknown as UndiciRequestInit),
          dispatcher,
          redirect: "manual",
        }
        const execute = () =>
          undiciFetch(resolved.url, requestInit) as unknown as Promise<Response>
        response = options.propagate
          ? await options.propagate(resolved.url, execute)
          : await execute()
      } finally {
        releasePin()
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get("location")
      if (!location) return response
      resolved = await resolveSafePublicUrl(
        new URL(location, resolved.url),
        resolver
      )
    }
    throw new Error("Too many redirects")
  }) as typeof fetch
  return {
    fetch: safeFetch,
    close: () => dispatcher.close(),
  }
}

export function createPinnedLookup(): {
  readonly pin: (
    hostname: string,
    addresses: readonly LookupAddress[]
  ) => () => void
  readonly lookup: LookupFunction
} {
  const pinned = new Map<string, Map<symbol, readonly LookupAddress[]>>()
  return {
    pin: (hostname, addresses) => {
      const key = normalizeHostname(hostname)
      let active = pinned.get(key)
      if (!active) {
        if (pinned.size >= MAX_CONCURRENT_PINNED_HOSTNAMES) {
          throw new Error("Too many concurrently pinned hostnames")
        }
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
      if (!selected) {
        const error = new Error(
          `No validated address is pinned for ${hostname}`
        ) as NodeJS.ErrnoException
        error.code = "ENOTFOUND"
        callback(error, "")
        return
      }
      if (options.all) {
        callback(null, [...candidates])
        return
      }
      callback(null, selected.address, selected.family)
    },
  }
}

export async function assertSafePublicUrl(value: string | URL): Promise<URL> {
  return (await resolveSafePublicUrl(value, resolveAddresses)).url
}

async function resolveSafePublicUrl(
  value: string | URL,
  resolver: AddressResolver
): Promise<{
  readonly url: URL
  readonly addresses: readonly LookupAddress[]
}> {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed")
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed")
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("Local addresses are not allowed")
  }
  const hostname = normalizeHostname(url.hostname)
  const family = isIP(hostname)
  const addresses = family
    ? [{ address: hostname, family }]
    : await resolver(hostname)
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivate(address))
  ) {
    throw new Error("Private or reserved addresses are not allowed")
  }
  return { url, addresses }
}

export function createSafeFetcher(
  baseFetcher: typeof fetch = fetch
): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    let url = await assertSafePublicUrl(
      input instanceof Request ? input.url : String(input)
    )
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await baseFetcher(url, { ...init, redirect: "manual" })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get("location")
      if (!location) return response
      url = await assertSafePublicUrl(new URL(location, url))
    }
    throw new Error("Too many redirects")
  }) as typeof fetch
}

function isPrivate(address: string): boolean {
  try {
    return ipaddr.parse(address).range() !== "unicast"
  } catch {
    return true
  }
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase()
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized
}

function resolveAddresses(hostname: string): Promise<readonly LookupAddress[]> {
  return lookup(hostname, { all: true })
}
