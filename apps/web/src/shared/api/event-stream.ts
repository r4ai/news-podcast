/**
 * SSE を `fetch` + `ReadableStream` で読む。`EventSource` を使わないのは、
 * 再開に必要な `Last-Event-ID` ヘッダを設定できないため。
 *
 * `client.ts` と同じく `globalThis.fetch` 越しに呼ぶので、テストは fetch を
 * 差し替えるだけでストリームを制御できる。
 */

export type SseFrame = {
  readonly id?: string
  readonly event: string
  readonly data: string
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

export type SubscribeOptions = {
  readonly signal: AbortSignal
  readonly onFrame: (frame: SseFrame) => void
  /** 接続確立時。フォールバック解除の判断に使う。 */
  readonly onOpen?: () => void
  /** 再接続を諦めた（=連続失敗が上限に達した）とき。 */
  readonly onGiveUp?: (error: unknown) => void
  /** これを超えて連続失敗したら諦める。 */
  readonly maxRetries?: number
}

/**
 * ストリームを購読し、切断されたら `Last-Event-ID` を持って再接続する。
 * サーバが正常終了（ストリームを閉じる）した場合は再接続しない。
 */
export async function subscribeEventStream(
  url: string,
  options: SubscribeOptions
): Promise<void> {
  const maxRetries = options.maxRetries ?? 2
  let lastEventId: string | undefined
  let failures = 0

  while (!options.signal.aborted) {
    try {
      const response = await globalThis.fetch(url, {
        credentials: "include",
        headers: {
          Accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
        signal: options.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`Event stream failed with ${response.status}`)
      }
      failures = 0
      options.onOpen?.()
      for await (const frame of readFrames(response.body)) {
        if (frame.id !== undefined) lastEventId = frame.id
        options.onFrame(frame)
      }
      // サーバが閉じた = ジョブが終端に達した。再接続しない。
      return
    } catch (error) {
      if (options.signal.aborted) return
      failures += 1
      if (failures > maxRetries) {
        options.onGiveUp?.(error)
        return
      }
      await delay(
        Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS),
        options.signal
      )
    }
  }
}

async function* readFrames(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // フレーム区切りは空行。最後の断片は次のチャンクまで持ち越す。
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseFrame(chunk)
        if (frame) yield frame
        boundary = buffer.indexOf("\n\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(chunk: string): SseFrame | undefined {
  let id: string | undefined
  let event = "message"
  const data: string[] = []
  for (const line of chunk.split("\n")) {
    // コメント行（ハートビート）は読み飛ばす。
    if (line.length === 0 || line.startsWith(":")) continue
    const separator = line.indexOf(":")
    const field = separator === -1 ? line : line.slice(0, separator)
    const rawValue = separator === -1 ? "" : line.slice(separator + 1)
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue
    if (field === "id") id = value
    else if (field === "event") event = value
    else if (field === "data") data.push(value)
  }
  if (data.length === 0) return undefined
  return { ...(id === undefined ? {} : { id }), event, data: data.join("\n") }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
