/**
 * W3C Trace Contextの最小実装。
 *
 * OTelのSDKを遅延読み込みにしても、**`traceparent`の注入だけは同期で行う**
 * 必要がある。注入が間に合わないと、初回のfetchをGatewayが受けた時点で別の
 * traceが根から作られ、後からブラウザ側にspanを起こしても同じtraceへ繋がらない
 * (ADR-0017・ADR-0025)。ここが持つのはid生成とheaderの組み立てだけで、
 * SDKには依存しない。
 */

/** `otel.ts`のsamplerと同じ比率。両方を同じ値で動かすためにここが正本。 */
export const TRACE_SAMPLE_RATIO = 0.2

export type PreInitSpanContext = {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return hex(bytes)
}

/**
 * `TraceIdRatioBasedSampler`と同じ判定をtrace idから行う。
 *
 * 常に`sampled`で注入すると、初回の数リクエストだけ全数採取になり比率が歪む。
 * SDK側は`ParentBasedSampler`なので、ここで決めた結果がそのまま尊重される。
 */
export function isSampled(
  traceId: string,
  ratio = TRACE_SAMPLE_RATIO
): boolean {
  const lower = Number.parseInt(traceId.slice(-8), 16)
  return lower < ratio * 0x1_0000_0000
}

export function createSpanContext(): PreInitSpanContext {
  const traceId = randomHex(16)
  return { traceId, spanId: randomHex(8), sampled: isSampled(traceId) }
}

export function toTraceparent(context: PreInitSpanContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`
}
