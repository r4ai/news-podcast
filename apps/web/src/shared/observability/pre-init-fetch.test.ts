import { afterEach, describe, expect, it, vi } from "vitest"

import { installPreInitFetchLog } from "./pre-init-fetch"
import { isSampled, toTraceparent } from "./trace-context"

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/

describe("installPreInitFetchLog", () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })

  /** shimは通す相手だけRequestへ組み直す。素通しの場合は文字列のまま届く。 */
  function stub(
    respond: () => Promise<Response> = async () => new Response("")
  ) {
    const seen: Array<string | null> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(
        input instanceof Request ? input.headers.get("traceparent") : null
      )
      return respond()
    }) as unknown as typeof fetch
    return seen
  }

  /**
   * SDKの到着を待って注入すると、その間のfetchをGatewayが受けた時点で別の
   * traceが根から作られる。後からspanを起こしても繋がらないので、注入だけは
   * 同期で行う必要がある。
   */
  it("same-originの要求へtraceparentを同期で注入する", async () => {
    const seen = stub()
    const log = installPreInitFetchLog()

    await fetch("/v1/me/articles")

    const header = seen[0]
    expect(header).toMatch(TRACEPARENT)
    const [record] = log.drain()
    expect(toTraceparent(record!.spanContext)).toBe(header)
  })

  it("外部のoriginへはtrace contextを漏らさない", async () => {
    const seen = stub()
    installPreInitFetchLog()

    await fetch("https://example.com/rss.xml")

    expect(seen[0]).toBeNull()
  })

  it("記録した時刻と応答の状態を残す", async () => {
    stub(async () => new Response("", { status: 503 }))
    const log = installPreInitFetchLog()

    await fetch("/v1/me/articles")

    const [record] = log.drain()
    expect(record?.status).toBe(503)
    expect(record?.method).toBe("GET")
    expect(record!.endTime).toBeGreaterThanOrEqual(record!.startTime)
  })

  it("失敗した要求も種類だけ残す", async () => {
    stub(async () => {
      throw new TypeError("network down")
    })
    const log = installPreInitFetchLog()

    await expect(fetch("/v1/me/articles")).rejects.toThrow()
    expect(log.drain()[0]?.errorType).toBe("TypeError")
  })

  it("drainした後は素通しになる", async () => {
    const seen = stub()
    const log = installPreInitFetchLog()
    log.drain()

    await fetch("/v1/me/articles")

    expect(seen[0]).toBeNull()
    expect(log.drain()).toEqual([])
  })
})

describe("isSampled", () => {
  /**
   * 常にsampledで注入すると初回の数リクエストだけ全数採取になり、比率が歪む。
   * SDK側は`ParentBasedSampler`なので、ここでの判定がそのまま尊重される。
   */
  it("trace idの下位32bitと比率で決める", () => {
    expect(isSampled(`${"0".repeat(24)}00000000`, 0.2)).toBe(true)
    expect(isSampled(`${"0".repeat(24)}ffffffff`, 0.2)).toBe(false)
    expect(isSampled(`${"0".repeat(24)}ffffffff`, 1)).toBe(true)
  })
})
