import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  createEnrichmentOperations,
  type EnrichmentProviderError,
  type EnrichmentQueueRepository,
} from "./enrichment.js"
import { CapturedAtSchema } from "../domain/article.js"
import { TagNameSchema } from "../domain/content-taxonomy.js"
import { OwnerIdSchema } from "../domain/subscription.js"

const now = Schema.decodeUnknownSync(CapturedAtSchema)(
  "2026-08-13T01:00:00.000Z"
)
const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)("owner-a")
const target = {
  articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  title: "Article",
  markdownKey: "articles/a/article.md",
  leaseToken: "lease-token-0001",
} as never

const queue = (budgetUsed = 0): EnrichmentQueueRepository =>
  ({
    reconcile: vi.fn(() => Effect.void),
    listOwners: vi.fn(() => Effect.succeed([ownerId])),
    claim: vi.fn(() => Effect.succeed([target])),
    completeSuccess: vi.fn(() => Effect.void),
    completeFailure: vi.fn(() => Effect.void),
    budgetUsed: vi.fn(() => Effect.succeed(budgetUsed)),
    status: vi.fn(() =>
      Effect.succeed({
        processing: [],
        pending: { count: 0, items: [] },
        failed: { count: 0, items: [] },
        recent: [],
        daily: { used: 0, limit: 200 },
        reprocessable: { count: 0 },
      })
    ),
    enqueueReprocess: vi.fn(() => Effect.succeed(0)),
    enqueueOne: vi.fn(() => Effect.succeed({ _tag: "Enqueued" })),
    resetDaily: vi.fn(() => Effect.void),
  }) as never

const operations = (
  repository: EnrichmentQueueRepository,
  enrich: (input: unknown) => Effect.Effect<unknown, EnrichmentProviderError>
) =>
  createEnrichmentOperations({
    queue: repository,
    taxonomy: {
      vocabulary: () =>
        Effect.succeed([Schema.decodeUnknownSync(TagNameSchema)("Known")]),
    },
    interestProfiles: {
      get: () => Effect.succeed({ include: "AI", exclude: "sports" }),
    },
    source: {
      read: (_key, maximumCharacters) => {
        expect(maximumCharacters).toBe(6_000)
        return Effect.succeed("markdown")
      },
    },
    provider: { enrich },
    dailyLimit: 200,
    now: () => now,
    newLeaseToken: () => "lease-token-0001",
  })

describe("enrichment operations", () => {
  it("validates a successful provider response before the durable transition", async () => {
    const repository = queue()
    const result = await Effect.runPromise(
      operations(repository, () =>
        Effect.succeed({
          summary: "summary",
          score: 90,
          reason: "matches",
          tags: ["Known"],
          suggestedTags: ["Novel"],
          tokensIn: 10,
          tokensOut: 5,
        })
      ).runCycle()
    )

    expect(result).toEqual({ processed: 1 })
    expect(repository.completeSuccess).toHaveBeenCalledWith(
      ownerId,
      target,
      expect.objectContaining({ score: 90 }),
      now,
      "2026-08-13"
    )
  })

  it("terminalizes malformed or out-of-vocabulary provider output", async () => {
    for (const output of [
      { score: "invalid" },
      {
        summary: "summary",
        score: 90,
        reason: "matches",
        tags: ["Not in vocabulary"],
        suggestedTags: [],
        tokensIn: 1,
        tokensOut: 1,
      },
    ]) {
      const repository = queue()
      expect(
        await Effect.runPromise(
          operations(repository, () => Effect.succeed(output)).runCycle()
        )
      ).toEqual({ processed: 0 })
      expect(repository.completeFailure).toHaveBeenCalledWith(
        ownerId,
        target,
        expect.any(String),
        false,
        now
      )
    }
  })

  it("classifies provider failures without exposing fake success", async () => {
    const repository = queue()
    await Effect.runPromise(
      operations(repository, () =>
        Effect.fail({
          _tag: "EnrichmentProviderFailed",
          reason: "RateLimited",
          message: "retry later",
        })
      ).runCycle()
    )
    expect(repository.completeFailure).toHaveBeenCalledWith(
      ownerId,
      target,
      "retry later",
      true,
      now
    )
  })

  it("does not claim work after the durable daily budget is exhausted", async () => {
    const repository = queue(200)
    expect(
      await Effect.runPromise(
        operations(repository, () => Effect.die("must not run")).runCycle()
      )
    ).toEqual({ processed: 0 })
    expect(repository.claim).not.toHaveBeenCalled()
  })
})
