import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const MAX_REDIRECTS = 5

export async function assertSafePublicUrl(value: string | URL): Promise<URL> {
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
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true })
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivate(address))
  ) {
    throw new Error("Private or reserved addresses are not allowed")
  }
  return url
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
  const normalized = address.toLowerCase()
  if (normalized === "::1" || normalized === "::") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  const candidate = mapped ?? normalized
  const parts = candidate.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}
