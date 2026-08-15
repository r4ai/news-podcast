import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import type { ProviderRetryPolicy } from "../../domain/provider-reliability.js"
import {
  makeOpenAiScriptGenerator,
  type OpenAiScriptGeneratorDependencies,
} from "./openai-script-generator.js"

const policy: ProviderRetryPolicy = {
  maximumAttempts: 2,
  maximumElapsedMillis: 10_000,
  baseDelayMillis: 25,
  maximumDelayMillis: 2_000,
}

const source = {
  title: "境界テスト記事",
  url: "https://example.test/article",
  markdown: "外部provider境界を安全に検証する記事本文",
}

const successPayload = {
  title: "今日のニュース",
  script: "境界の検証結果をお伝えします。".repeat(5),
  source_urls: [source.url],
}

const completed = (payload: unknown) => ({
  id: "resp_provider_only",
  status: "completed",
  output: [
    { type: "reasoning", provider_only: true },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify(payload),
          annotations: [],
        },
      ],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
})

const completedText = (text: string) => ({
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text }],
    },
  ],
})

type ScriptedResponse = Readonly<{
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

const startScriptedServer = async (script: readonly ScriptedResponse[]) => {
  const requests: string[] = []
  let requestCount = 0
  let notifyRequest = () => {}
  const requestObserved = new Promise<void>((resolve) => {
    notifyRequest = resolve
  })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      requests.push(Buffer.concat(chunks).toString("utf8"))
      requestCount += 1
      notifyRequest()
      const next = script[Math.min(requestCount - 1, script.length - 1)]!
      if (next.hang) return
      response.writeHead(next.status ?? 200, {
        "content-type": "application/json",
        ...(next.headers ?? {}),
      })
      response.end(next.body ?? JSON.stringify(completed(successPayload)))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    endpoint: new URL(`http://127.0.0.1:${address.port}/v1/responses`),
    requests,
    requestObserved,
    requestCount: () => requestCount,
  }
}

const makeGenerator = (
  endpoint: URL,
  input: {
    readonly fetcher?: typeof fetch
    readonly requestTimeoutMillis?: number
    readonly runtime?: OpenAiScriptGeneratorDependencies["retryRuntime"]
  } = {}
) =>
  makeOpenAiScriptGenerator(
    {
      endpoint,
      apiKey: "test-only-key",
      model: "test-model",
      requestTimeoutMillis: input.requestTimeoutMillis ?? 1_000,
      retryPolicy: policy,
    },
    {
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
      ...(input.runtime ? { retryRuntime: input.runtime } : {}),
    }
  )

const generate = (
  generator: ReturnType<typeof makeGenerator>,
  signal?: AbortSignal
) => generator.generate({ sources: [source], ...(signal ? { signal } : {}) })

describe("OpenAI ScriptGenerator HTTP boundary", () => {
  it("accepts reasoning-first Responses output and returns a frozen application value", async () => {
    const fake = await startScriptedServer([
      { body: JSON.stringify(completed(successPayload)) },
    ])

    const draft = await Effect.runPromise(
      generate(makeGenerator(fake.endpoint))
    )

    expect(draft).toEqual({
      title: successPayload.title,
      script: successPayload.script,
      sourceUrls: successPayload.source_urls,
    })
    expect(Object.isFrozen(draft)).toBe(true)
    expect(Object.isFrozen(draft.sourceUrls)).toBe(true)
    const request = JSON.parse(fake.requests[0]!) as Record<string, unknown>
    expect(Object.keys(request).sort()).toEqual([
      "input",
      "max_output_tokens",
      "model",
      "text",
    ])
    expect(request.max_output_tokens).toBe(4_096)
    expect(request).not.toHaveProperty("temperature")
    expect(fake.requests[0]).toContain(source.markdown)
    expect(fake.requests[0]).not.toContain("test-only-key")
  })

  it("bounds every article before building a scheduled 20-source request", async () => {
    const fake = await startScriptedServer([
      { body: JSON.stringify(completed(successPayload)) },
    ])
    const sources = Array.from({ length: 20 }, (_, index) => ({
      title: `記事${index}`,
      url: index === 0 ? source.url : `https://example.test/article-${index}`,
      markdown: "長".repeat(6_001),
    }))

    await Effect.runPromise(makeGenerator(fake.endpoint).generate({ sources }))

    const request = JSON.parse(fake.requests[0]!) as {
      input: [{ content: string }, { content: string }]
    }
    const input = JSON.parse(request.input[1].content) as {
      sources: Array<{ markdown: string }>
    }
    expect(input.sources).toHaveLength(20)
    expect(
      input.sources.every(
        ({ markdown }) => Array.from(markdown).length <= 6_000
      )
    ).toBe(true)
    expect(
      input.sources.reduce(
        (length, { markdown }) => length + Array.from(markdown).length,
        0
      )
    ).toBeLessThanOrEqual(120_000)
  })

  it.each([
    ["invalid JSON", "not-json"],
    ["invalid output JSON", JSON.stringify(completedText("not-json"))],
    [
      "missing output text",
      JSON.stringify({ status: "completed", output: [{ type: "reasoning" }] }),
    ],
    [
      "an excess application field",
      JSON.stringify(completed({ ...successPayload, provider_only: true })),
    ],
    [
      "an overlong script",
      JSON.stringify(
        completed({ ...successPayload, script: "長".repeat(6_001) })
      ),
    ],
    [
      "an unobserved source URL",
      JSON.stringify(
        completed({
          ...successPayload,
          source_urls: ["https://unobserved.example.test/article"],
        })
      ),
    ],
  ])(
    "classifies %s as a non-retryable malformed response",
    async (_case, body) => {
      const fake = await startScriptedServer([{ body }])

      const failure = await Effect.runPromise(
        Effect.flip(generate(makeGenerator(fake.endpoint)))
      )

      expect(failure).toEqual({ _tag: "MalformedResponse" })
      expect(fake.requestCount()).toBe(1)
    }
  )

  it.each([
    [
      "a non-JSON media type",
      { headers: { "content-type": "text/plain" }, body: "{}" },
    ],
    [
      "an oversized declared response",
      {
        headers: {
          "content-type": "application/json",
          "content-length": "1048577",
        },
        body: "{}",
      },
    ],
  ])(
    "rejects %s before provider data enters the domain",
    async (_case, reply) => {
      const fake = await startScriptedServer([reply])
      await expect(
        Effect.runPromise(Effect.flip(generate(makeGenerator(fake.endpoint))))
      ).resolves.toEqual({ _tag: "MalformedResponse" })
    }
  )

  it("classifies a refusal without retaining refusal text", async () => {
    const fake = await startScriptedServer([
      {
        body: JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "secret refusal detail" }],
            },
          ],
        }),
      },
    ])

    const failure = await Effect.runPromise(
      Effect.flip(generate(makeGenerator(fake.endpoint)))
    )

    expect(failure).toEqual({ _tag: "Refusal" })
    expect(JSON.stringify(failure)).not.toContain("secret refusal detail")
  })

  it("classifies incomplete output and exhausts the bounded retry", async () => {
    const fake = await startScriptedServer([
      {
        body: JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens secret detail" },
          output: [],
        }),
      },
    ])
    const delays: number[] = []
    const generator = makeGenerator(fake.endpoint, {
      runtime: {
        nowMillis: () => Effect.succeed(0),
        sleep: (delayMillis) =>
          Effect.sync(() => {
            delays.push(delayMillis)
          }),
      },
    })

    const failure = await Effect.runPromise(Effect.flip(generate(generator)))

    expect(failure).toEqual({
      _tag: "ProviderRetryExhausted",
      attempts: 2,
      reason: "AttemptLimit",
      lastFailure: { _tag: "Incomplete" },
    })
    expect(delays).toEqual([25])
    expect(JSON.stringify(failure)).not.toContain("secret detail")
  })

  it.each([
    [429, { "retry-after": "2" }, 2_000],
    [429, {}, 2_000],
    [500, {}, 25],
  ] as const)(
    "retries HTTP %s once through the shared retry budget",
    async (status, headers, expectedDelay) => {
      const fake = await startScriptedServer([
        {
          status,
          headers,
          body: JSON.stringify({ error: { message: "secret provider body" } }),
        },
        { body: JSON.stringify(completed(successPayload)) },
      ])
      const delays: number[] = []
      const generator = makeGenerator(fake.endpoint, {
        runtime: {
          nowMillis: () => Effect.succeed(0),
          sleep: (delayMillis) =>
            Effect.sync(() => {
              delays.push(delayMillis)
            }),
        },
      })

      const draft = await Effect.runPromise(generate(generator))

      expect(draft.title).toBe(successPayload.title)
      expect(fake.requestCount()).toBe(2)
      expect(delays).toEqual([expectedDelay])
    }
  )

  it("does not retain or retry a 4xx error body", async () => {
    const fake = await startScriptedServer([
      {
        status: 400,
        body: JSON.stringify({
          error: { message: `${source.markdown} secret provider error` },
        }),
      },
    ])

    const failure = await Effect.runPromise(
      Effect.flip(generate(makeGenerator(fake.endpoint)))
    )

    expect(failure).toEqual({ _tag: "HttpFailure", status: 400 })
    expect(JSON.stringify(failure)).not.toContain(source.markdown)
    expect(fake.requestCount()).toBe(1)
  })

  it("aborts a hanging request without retrying", async () => {
    const fake = await startScriptedServer([{ hang: true }])
    const controller = new AbortController()
    const pending = Effect.runPromise(
      Effect.flip(generate(makeGenerator(fake.endpoint), controller.signal))
    )
    await fake.requestObserved

    controller.abort()

    await expect(pending).resolves.toEqual({ _tag: "Canceled" })
    expect(fake.requestCount()).toBe(1)
  })

  it("aborts an active Retry-After sleep without starting another request", async () => {
    const fake = await startScriptedServer([
      { status: 500, body: JSON.stringify({ error: "unavailable" }) },
    ])
    const controller = new AbortController()
    let notifySleep = () => {}
    const sleeping = new Promise<void>((resolve) => {
      notifySleep = resolve
    })
    let sleepInterrupted = false
    const generator = makeGenerator(fake.endpoint, {
      runtime: {
        nowMillis: () => Effect.succeed(0),
        sleep: () =>
          Effect.sync(notifySleep).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                sleepInterrupted = true
              })
            )
          ),
      },
    })
    const pending = Effect.runPromise(
      Effect.flip(generate(generator, controller.signal))
    )
    await sleeping

    controller.abort()

    await expect(pending).resolves.toEqual({ _tag: "Canceled" })
    expect(sleepInterrupted).toBe(true)
    expect(fake.requestCount()).toBe(1)
  })

  it("classifies a request deadline and stops after the timeout retry budget", async () => {
    let requests = 0
    const fetcher: typeof fetch = async (_input, init) => {
      requests += 1
      const signal = init?.signal
      if (!signal) throw new Error("request signal missing")
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"))
        if (signal.aborted) abort()
        else signal.addEventListener("abort", abort, { once: true })
      })
    }
    const generator = makeGenerator(
      new URL("http://provider.invalid/v1/responses"),
      {
        requestTimeoutMillis: 20,
        fetcher,
        runtime: {
          nowMillis: () => Effect.succeed(0),
          sleep: () => Effect.void,
        },
      }
    )

    const failure = await Effect.runPromise(Effect.flip(generate(generator)))

    expect(failure).toEqual({
      _tag: "ProviderRetryExhausted",
      attempts: 2,
      reason: "AttemptLimit",
      lastFailure: { _tag: "Timeout" },
    })
    expect(requests).toBe(2)
  })
})
