import { describe, expect, it, vi } from "vitest"

import { makeBoundedFetch } from "./bounded-fetch.js"

describe("bounded AI response transport", () => {
  it("rejects a declared oversized response before decoding", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("oversized", {
          headers: {
            "content-length": "9",
            "content-type": "application/json",
          },
        })
    )
    const bounded = makeBoundedFetch({ maximumResponseBytes: 8, fetcher })

    await expect(bounded("https://example.test")).rejects.toMatchObject({
      name: "ResponseSizeLimitError",
      message: "response_too_large",
    })
  })

  it("rejects a chunked oversized response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode("12345"))
              controller.enqueue(new TextEncoder().encode("67890"))
              controller.close()
            },
          })
        )
    )
    const bounded = makeBoundedFetch({ maximumResponseBytes: 8, fetcher })

    await expect(bounded("https://example.test")).rejects.toThrow(
      "response_too_large"
    )
  })
})
