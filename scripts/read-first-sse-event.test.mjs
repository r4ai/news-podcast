import assert from "node:assert/strict"
import { test } from "node:test"

import { readFirstSseEvent } from "./read-first-sse-event.mjs"

test("reads one complete SSE event and cancels the still-open stream", async () => {
  const encoder = new TextEncoder()
  let canceled = false
  const chunks = [
    encoder.encode('event: state\ndata: {"status":'),
    encoder.encode('"queued"}\n\n'),
    encoder.encode("event: never-read\ndata: {}\n\n"),
  ]

  const response = new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk) {
          controller.enqueue(chunk)
        } else {
          controller.close()
        }
      },
      cancel() {
        canceled = true
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  )

  await assert.doesNotReject(async () => {
    const event = await readFirstSseEvent(response)
    assert.equal(event, 'event: state\ndata: {"status":"queued"}')
  })
  assert.equal(canceled, true)
})
