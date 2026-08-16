import {
  createSpanContext,
  toTraceparent,
  type PreInitSpanContext,
} from "./trace-context"

/**
 * OTelのSDKが載るまでのfetchを、traceへ繋がる形で扱う。
 *
 * ブラウザの計装は`window.fetch`を差し替えることで効くので、SDKを遅延読み込み
 * にすると、その間に飛んだ認証確認や最初のqueryが計装から漏れる。「計装の穴を
 * 作らない」(ADR-0025) を保ったまま初期表示を軽くするために、差し替えのうち
 * **同期で行う必要がある部分だけ**を先に置く。
 *
 * 同期で行うのは2つ。
 *
 * 1. **`traceparent`の注入**。これが遅れると、Gatewayが受けた時点で別のtraceが
 *    根から作られ、後からspanを起こしても同じtraceへ繋がらない。記録した
 *    trace idは、SDK到着時に同じtraceへspanを置くために使う。
 * 2. **時刻の記録**。SDKが載った時点で、実際の開始・終了時刻のままspanへ起こす。
 *
 * 記録は上限つき。SDKの読み込みに失敗しても際限なく溜まることはない。
 */

export type PreInitRequest = {
  readonly method: string
  readonly url: string
  /** `Date.now()`基準。spanの開始・終了時刻としてそのまま使える。 */
  readonly startTime: number
  readonly endTime: number
  readonly status?: number
  readonly errorType?: string
  /** 注入した`traceparent`の中身。同じtraceへspanを置くために使う。 */
  readonly spanContext: PreInitSpanContext
}

export type PreInitFetchLog = {
  /** 記録を取り出し、以降の記録を止める。SDKが載った時点で1度だけ呼ぶ。 */
  readonly drain: () => readonly PreInitRequest[]
}

const MAX_RECORDS = 50

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * trace headerを送ってよい相手か。
 *
 * `FetchInstrumentation`の`propagateTraceHeaderCorsUrls: [location.origin]`と
 * 同じ範囲に揃える。管理外のserviceへtrace contextを漏らさない (ADR-0025)。
 */
export function isPropagationTarget(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin
  } catch {
    return false
  }
}

export function installPreInitFetchLog(): PreInitFetchLog {
  const records: PreInitRequest[] = []
  const original = globalThis.fetch
  let recording = true

  globalThis.fetch = async function tracked(
    input: RequestInfo | URL,
    init?: RequestInit
  ) {
    const url = requestUrl(input)
    if (!recording || !isPropagationTarget(url)) {
      return original(input, init)
    }

    const startTime = Date.now()
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase()
    const spanContext = createSpanContext()

    // Requestを組み立て直さず、headersだけを足して渡す。bodyの再読み込みが
    // 起きないようにするため。
    const request = new Request(input, init)
    request.headers.set("traceparent", toTraceparent(spanContext))

    const record = (extra: Partial<PreInitRequest>) => {
      if (records.length >= MAX_RECORDS) return
      records.push({
        method,
        url,
        startTime,
        endTime: Date.now(),
        spanContext,
        ...extra,
      })
    }

    try {
      const response = await original(request)
      record({ status: response.status })
      return response
    } catch (error) {
      record({
        errorType: error instanceof Error ? error.name : "UnknownError",
      })
      throw error
    }
  }

  return {
    drain: () => {
      recording = false
      return records.splice(0)
    },
  }
}
