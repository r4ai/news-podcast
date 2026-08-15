import type { Observability } from "../contract.js"
import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "../node-adapter.js"
import {
  isPropagationAllowed,
  readPropagationAllowlist,
  withPropagationDisabled,
} from "../propagation.js"

export interface RegisterOptions {
  readonly serviceName?: string
  readonly traceSampleRate?: number
}

let instance: Observability | undefined

/**
 * 自動計装を正本とするNodeエントリ。アプリ本体を動的importするbootstrapから呼び、
 * `@hono/node-server`等が `node:http` を静的キャプチャする前に計装を登録する。
 * これにより入り口HTTP・AWS SDK・fetchの全てでトレース欠落が物理的に起こり得ない。
 */
export function getNodeObservability(
  options: RegisterOptions = {}
): Observability {
  if (instance) return instance
  const config = readNodeObservabilityConfig(
    process.env,
    options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? "news-podcast"
  )
  const effectiveConfig = {
    ...config,
    ...(options.traceSampleRate !== undefined
      ? { traceSampleRate: options.traceSampleRate }
      : {}),
  }
  instance = createNodeObservability(effectiveConfig)
  return instance
}

/** テストでのみ使用する（インスタンス再生成のため）。 */
export function resetNodeObservabilityForTest(): void {
  instance = undefined
}

/**
 * `createNodeSafeFetcher`等、global fetchを使わないoutbound経路へ渡す伝播フック。
 * allowlist外の宛先ではW3C Trace Contextの注入を抑制する（ADR-0017）。
 */
export function createPropagationHook(): (
  url: URL,
  execute: () => Promise<Response>
) => Promise<Response> {
  const allowlist = readPropagationAllowlist(process.env)
  return (url, execute) =>
    isPropagationAllowed(url, allowlist)
      ? execute()
      : withPropagationDisabled(execute)
}
