import {
  context,
  createContextKey,
  type Context,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from "@opentelemetry/api"
import { W3CTraceContextPropagator } from "@opentelemetry/core"
// ESM名前空間はfrozenのため、変更可能なCJS exports（default import）で包む。
import http from "node:http"
import https from "node:https"

/**
 * contextにこのkeyが設定されている間は、W3C Trace Contextの注入を抑制する。
 * span自体は自動計装が生成し続けるため、トレースの欠落は発生しない。
 */
export const propagationDisabledKey: symbol = createContextKey(
  "news-podcast.propagation.disabled"
)

/**
 * 信頼できる宛先（allowlist）へだけtraceparentを注入し、それ以外
 * （任意RSSサイトなど）へは識別子を漏らさないTextMapPropagator。
 * extractは常にW3Cへ委譲し、受信側の相関は維持する。
 */
export const makeAllowlistTextMapPropagator = (): TextMapPropagator => {
  const delegate = new W3CTraceContextPropagator()
  return Object.freeze({
    inject: (
      activeContext: Context,
      carrier: unknown,
      setter: TextMapSetter
    ): void => {
      if (activeContext.getValue(propagationDisabledKey)) return
      delegate.inject(activeContext, carrier, setter)
    },
    extract: (
      activeContext: Context,
      carrier: unknown,
      getter: TextMapGetter
    ): Context => delegate.extract(activeContext, carrier, getter),
    fields: (): string[] => delegate.fields(),
  })
}

export function readPropagationAllowlist(
  environment: NodeJS.ProcessEnv
): ReadonlySet<string> {
  const value = environment.OTEL_PROPAGATION_ALLOWLIST?.trim()
  if (!value) return new Set(DEFAULT_PROPAGATION_ALLOWLIST)
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * 既定では自己管理下のprovider（OpenAI、VOICEVOX、Self-hosted S3/SeaweedFS、
 * 自前Collector）だけに注入する。任意のRSSサイト等へは漏らさない
 * （ADR-0017のPrivacy契約を維持）。
 */
const DEFAULT_PROPAGATION_ALLOWLIST = [
  "api.openai.com",
  "127.0.0.1",
  "localhost",
] as const

export function isPropagationAllowed(
  url: URL,
  allowlist: ReadonlySet<string>
): boolean {
  return allowlist.has(url.hostname.toLowerCase())
}

/**
 * allowlist外の宛先へ向けたHTTP呼び出しを、伝播抑制付きcontextで実行する。
 * spanの生成は自動計装（undici/http）が行うため、トレースは維持される。
 * `createNodeSafeFetcher`のようなglobal fetch以外の経路でも同じ契約を守る。
 */
export function withPropagationDisabled<T>(
  execute: () => Promise<T>
): Promise<T> {
  const flagged = context.active().setValue(propagationDisabledKey, true)
  return context.with(flagged, execute)
}

/**
 * 自動計装の登録後に呼び、非allowlist宛先のoutbound HTTPを
 * `propagationDisabledKey`付きcontextで実行するようグローバルを包む。
 * spanの生成は自動計装に委ねたまま、注入だけを制御する。
 */
export function installPropagationGate(allowlist: ReadonlySet<string>): void {
  wrapGlobalFetch(allowlist)
  wrapModuleRequests(http, allowlist)
  wrapModuleRequests(https, allowlist)
}

function wrapGlobalFetch(allowlist: ReadonlySet<string>): void {
  const original = globalThis.fetch
  if (typeof original !== "function") return
  globalThis.fetch = ((input, init) => {
    const host = fetchHostname(input)
    if (host !== undefined && allowlist.has(host)) {
      return original(input, init)
    }
    const flagged = context.active().setValue(propagationDisabledKey, true)
    return context.with(flagged, () => original(input, init))
  }) as typeof fetch
}

function fetchHostname(input: RequestInfo | URL): string | undefined {
  try {
    const url =
      input instanceof Request ? new URL(input.url) : new URL(String(input))
    return url.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function wrapModuleRequests(
  module: unknown,
  allowlist: ReadonlySet<string>
): void {
  const record = module as Record<string, unknown>
  for (const name of ["request", "get"] as const) {
    const original = record[name] as HttpRequestFunction | undefined
    if (typeof original !== "function") continue
    const wrapped: HttpRequestFunction = (...args) => {
      const host = requestHostname(args[0])
      if (host !== undefined && allowlist.has(host)) {
        return original(...args)
      }
      const flagged = context.active().setValue(propagationDisabledKey, true)
      return context.with(flagged, () => original(...args))
    }
    record[name] = wrapped
  }
}

type HttpRequestFunction = (
  input: string | URL | http.RequestOptions,
  options?: http.RequestOptions,
  callback?: (response: http.IncomingMessage) => void
) => http.ClientRequest

function requestHostname(first: unknown): string | undefined {
  if (typeof first === "string") {
    try {
      return new URL(first).hostname.toLowerCase()
    } catch {
      return undefined
    }
  }
  if (first instanceof URL) return first.hostname.toLowerCase()
  if (first && typeof first === "object") {
    const options = first as {
      hostname?: unknown
      host?: unknown
    }
    const value = options.hostname ?? options.host
    if (typeof value === "string") {
      return value.split(":")[0]!.toLowerCase()
    }
  }
  return undefined
}
