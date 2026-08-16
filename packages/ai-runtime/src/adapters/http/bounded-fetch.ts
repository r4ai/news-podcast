export type BoundedFetchConfig = Readonly<{
  readonly maximumResponseBytes: number
  readonly fetcher?: typeof fetch
}>

const responseTooLarge = (): Error => {
  const error = new Error("response_too_large")
  error.name = "ResponseSizeLimitError"
  return error
}

const readBoundedBody = async (
  response: Response,
  maximumResponseBytes: number
): Promise<Uint8Array> => {
  const declared = response.headers.get("content-length")
  if (declared !== null) {
    const bytes = Number(declared)
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > maximumResponseBytes
    )
      throw responseTooLarge()
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    length += next.value.byteLength
    if (length > maximumResponseBytes) {
      await reader.cancel()
      throw responseTooLarge()
    }
    chunks.push(next.value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** Buffers only the bounded OpenAI JSON response and recreates an immutable response. */
export const makeBoundedFetch = (config: BoundedFetchConfig): typeof fetch => {
  const fetcher = config.fetcher ?? fetch
  return async (input, init) => {
    const response = await fetcher(input, init)
    const body = await readBoundedBody(response, config.maximumResponseBytes)
    return new Response(
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength
      ) as ArrayBuffer,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }
    )
  }
}
