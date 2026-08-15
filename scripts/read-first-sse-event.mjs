/**
 * Read the first complete Server-Sent Events frame without waiting for the
 * server to close the long-lived response.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
export async function readFirstSseEvent(response) {
  if (!response.body) {
    throw new Error("SSE response did not contain a readable body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let streamEnded = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        streamEnded = true
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const delimiter = buffer.match(/\r?\n\r?\n/)
      if (!delimiter || delimiter.index === undefined) continue

      return buffer.slice(0, delimiter.index).trim()
    }

    buffer += decoder.decode()
    const event = buffer.trim()
    if (!event) throw new Error("SSE response ended before its first event")
    return event
  } finally {
    if (!streamEnded) await reader.cancel()
    reader.releaseLock()
  }
}
