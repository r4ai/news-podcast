import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { makeOpenAiEnrichmentProvider } from "./openai-enrichment-provider.js"

const input = {
  articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  title: "境界テスト記事",
  markdown: "providerへ渡す記事本文",
  interestProfile: { include: "TypeScriptと型安全性", exclude: "" },
  tagVocabulary: ["技術", "経済"],
}

const payload = {
  summary: "型安全な境界についての記事です。",
  score: 90,
  reason: "関心トピックと一致します。",
  tags: ["技術"],
  suggestedTags: ["型安全"],
}

const completed = (value: unknown) => ({
  id: "provider-only-id",
  status: "completed",
  output: [
    { type: "reasoning", summary: [{ text: "never persist this" }] },
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
  usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 },
})

type Reply = Readonly<{
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly hang?: boolean
}>

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const startServer = async (replies: readonly Reply[]) => {
  const requests: Array<{ readonly headers: unknown; readonly body: string }> =
    []
  let count = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      requests.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      })
      const reply = replies[Math.min(count, replies.length - 1)]!
      count += 1
      if (reply.hang) return
      response.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...(reply.headers ?? {}),
      })
      response.end(reply.body ?? JSON.stringify(completed(payload)))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    endpoint: new URL(`http://127.0.0.1:${address.port}/v1/responses`),
    requests,
    count: () => count,
  }
}

const provider = (
  endpoint: URL,
  options: {
    readonly timeout?: number
    readonly sleep?: (milliseconds: number) => Effect.Effect<void>
  } = {}
) =>
  makeOpenAiEnrichmentProvider(
    {
      endpoint,
      apiKey: "test-only-key",
      model: "gpt-test",
      requestTimeoutMillis: options.timeout ?? 1_000,
      maximumAttempts: 2,
      baseDelayMillis: 25,
      maximumDelayMillis: 2_000,
    },
    { ...(options.sleep ? { sleep: options.sleep } : {}) }
  )

describe("OpenAI enrichment provider HTTP boundary", () => {
  it("sends strict structured output and projects only domain fields", async () => {
    const fake = await startServer([{}])

    const result = await Effect.runPromise(
      provider(fake.endpoint).enrich(input)
    )

    expect(result).toEqual({ ...payload, tokensIn: 123, tokensOut: 45 })
    expect(Object.isFrozen(result)).toBe(true)
    const request = JSON.parse(fake.requests[0]!.body) as Record<
      string,
      unknown
    >
    expect(Object.keys(request).sort()).toEqual(["input", "model", "text"])
    expect(request).not.toHaveProperty("temperature")
    expect(fake.requests[0]!.body).toContain(input.markdown)
    expect(fake.requests[0]!.body).not.toContain("test-only-key")
    expect(JSON.stringify(result)).not.toContain("never persist this")
  })

  it.each([
    [429, { "retry-after": "2" }, 2_000],
    [503, {}, 25],
  ] as const)(
    "retries HTTP %s with bounded delay",
    async (status, headers, delay) => {
      const fake = await startServer([
        {
          status,
          headers,
          body: JSON.stringify({ error: { message: "secret" } }),
        },
        {},
      ])
      const delays: number[] = []

      const result = await Effect.runPromise(
        provider(fake.endpoint, {
          sleep: (milliseconds) =>
            Effect.sync(() => void delays.push(milliseconds)),
        }).enrich(input)
      )

      expect(result).toMatchObject({ score: 90 })
      expect(fake.count()).toBe(2)
      expect(delays).toEqual([delay])
    }
  )

  it("does not retry or retain 4xx provider errors", async () => {
    const fake = await startServer([
      {
        status: 400,
        body: JSON.stringify({ error: { message: input.markdown } }),
      },
    ])

    const failure = await Effect.runPromise(
      Effect.flip(provider(fake.endpoint).enrich(input))
    )

    expect(failure).toEqual({
      _tag: "EnrichmentProviderFailed",
      reason: "Permanent",
      message: "enrichment provider rejected request",
    })
    expect(JSON.stringify(failure)).not.toContain(input.markdown)
    expect(fake.count()).toBe(1)
  })

  it("does not shorten an excessive Retry-After value", async () => {
    const fake = await startServer([
      { status: 429, headers: { "retry-after": "60" }, body: "{}" },
    ])
    const delays: number[] = []

    const failure = await Effect.runPromise(
      Effect.flip(
        provider(fake.endpoint, {
          sleep: (milliseconds) =>
            Effect.sync(() => void delays.push(milliseconds)),
        }).enrich(input)
      )
    )

    expect(failure).toEqual({
      _tag: "EnrichmentProviderFailed",
      reason: "RateLimited",
      message: "enrichment provider rate limited",
    })
    expect(delays).toEqual([])
    expect(fake.count()).toBe(1)
  })

  it.each([
    ["invalid JSON", "not-json"],
    [
      "extra payload field",
      JSON.stringify(completed({ ...payload, reasoning: "secret" })),
    ],
    [
      "unknown tag",
      JSON.stringify(completed({ ...payload, tags: ["未登録"] })),
    ],
    [
      "refusal",
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "secret refusal" }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ],
  ])("fails closed for %s without retry", async (_case, body) => {
    const fake = await startServer([{ body }])

    const failure = await Effect.runPromise(
      Effect.flip(provider(fake.endpoint).enrich(input))
    )

    expect(failure).toMatchObject({
      _tag: "EnrichmentProviderFailed",
      reason: "Permanent",
    })
    expect(JSON.stringify(failure)).not.toContain("secret")
    expect(fake.count()).toBe(1)
  })

  it("retries a request timeout only within the attempt budget", async () => {
    const fake = await startServer([{ hang: true }])

    const failure = await Effect.runPromise(
      Effect.flip(
        provider(fake.endpoint, {
          timeout: 20,
          sleep: () => Effect.void,
        }).enrich(input)
      )
    )

    expect(failure).toEqual({
      _tag: "EnrichmentProviderFailed",
      reason: "Retryable",
      message: "enrichment provider request timed out",
    })
    expect(fake.count()).toBe(2)
  })
})
