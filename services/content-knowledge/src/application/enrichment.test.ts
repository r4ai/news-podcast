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
    reserveAttempt: vi.fn(() => Effect.succeed(true)),
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
  enrich: (input: unknown) => Effect.Effect<unknown, EnrichmentProviderError>,
  currentTime: () => typeof now = () => now,
  dailyLimit = 200,
  observeAttempt?: (outcome: "Reserved" | "BudgetExhausted") => void
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
    dailyLimit,
    now: currentTime,
    newLeaseToken: () => "lease-token-0001",
    observeAttempt,
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
      now
    )
  })

  it("accounts a paid attempt against the UTC date when the provider call starts", async () => {
    const repository = queue()
    const startedAt = Schema.decodeUnknownSync(CapturedAtSchema)(
      "2026-08-17T23:59:58.000Z"
    )
    const attemptedAt = Schema.decodeUnknownSync(CapturedAtSchema)(
      "2026-08-17T23:59:59.000Z"
    )
    const completedAt = Schema.decodeUnknownSync(CapturedAtSchema)(
      "2026-08-18T00:00:02.000Z"
    )
    const instants = [startedAt, attemptedAt, completedAt]

    await Effect.runPromise(
      operations(
        repository,
        () =>
          Effect.succeed({
            summary: "summary",
            score: 90,
            reason: "matches",
            tags: ["Known"],
            suggestedTags: [],
            tokensIn: 10,
            tokensOut: 5,
          }),
        () => instants.shift() ?? completedAt
      ).runCycle()
    )

    expect(repository.reserveAttempt).toHaveBeenCalledWith(
      ownerId,
      target,
      attemptedAt,
      "2026-08-17",
      200
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
    const observeAttempt = vi.fn()
    await Effect.runPromise(
      operations(
        repository,
        () =>
          Effect.fail({
            _tag: "EnrichmentProviderFailed",
            reason: "RateLimited",
            message: "retry later",
          }),
        () => now,
        200,
        observeAttempt
      ).runCycle()
    )
    expect(repository.completeFailure).toHaveBeenCalledWith(
      ownerId,
      target,
      "retry later",
      true,
      now
    )
    expect(repository.reserveAttempt).toHaveBeenCalledWith(
      ownerId,
      target,
      now,
      "2026-08-13",
      200
    )
    expect(observeAttempt).toHaveBeenCalledWith("Reserved")
  })

  it("does not start a second paid attempt after a failed provider call consumes the daily limit", async () => {
    let used = 0
    const repository = {
      ...queue(),
      budgetUsed: vi.fn(() => Effect.succeed(used)),
      reserveAttempt: vi.fn(() => {
        if (used >= 1) return Effect.succeed(false)
        used += 1
        return Effect.succeed(true)
      }),
    } as EnrichmentQueueRepository
    const enrich = vi.fn(() =>
      Effect.fail({
        _tag: "EnrichmentProviderFailed" as const,
        reason: "RateLimited" as const,
        message: "retry later",
      })
    )
    const operation = operations(repository, enrich, () => now, 1)

    await Effect.runPromise(operation.runCycle())
    await Effect.runPromise(operation.runCycle())

    expect(enrich).toHaveBeenCalledTimes(1)
    expect(used).toBe(1)
    expect(repository.claim).toHaveBeenCalledTimes(1)
  })

  it("counts a timeout as a paid attempt and keeps it retryable", async () => {
    const repository = queue()
    await Effect.runPromise(
      operations(repository, () =>
        Effect.fail({
          _tag: "EnrichmentProviderFailed",
          reason: "Retryable",
          message: "provider timeout",
        })
      ).runCycle()
    )

    expect(repository.reserveAttempt).toHaveBeenCalledOnce()
    expect(repository.completeFailure).toHaveBeenCalledWith(
      ownerId,
      target,
      "provider timeout",
      true,
      now
    )
  })

  it("does not call the provider when the atomic reservation finds no remaining budget", async () => {
    const repository = {
      ...queue(),
      reserveAttempt: vi.fn(() => Effect.succeed(false)),
    } as EnrichmentQueueRepository
    const enrich = vi.fn(() => Effect.die("must not run"))
    const observeAttempt = vi.fn()

    expect(
      await Effect.runPromise(
        operations(repository, enrich, () => now, 1, observeAttempt).runCycle()
      )
    ).toEqual({ processed: 0 })
    expect(enrich).not.toHaveBeenCalled()
    expect(repository.completeFailure).not.toHaveBeenCalled()
    expect(observeAttempt).toHaveBeenCalledWith("BudgetExhausted")
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

  it("continues with another owner when one owner's daily budget is exhausted", async () => {
    const ownerB = Schema.decodeUnknownSync(OwnerIdSchema)("owner-b")
    const repository = {
      ...queue(),
      listOwners: vi.fn(() => Effect.succeed([ownerId, ownerB])),
      budgetUsed: vi.fn((owner) => Effect.succeed(owner === ownerId ? 200 : 0)),
      claim: vi.fn((owner) => Effect.succeed(owner === ownerB ? [target] : [])),
    } as EnrichmentQueueRepository

    expect(
      await Effect.runPromise(
        operations(repository, () =>
          Effect.succeed({
            summary: "summary",
            score: 90,
            reason: "matches",
            tags: ["Known"],
            suggestedTags: [],
            tokensIn: 10,
            tokensOut: 5,
          })
        ).runCycle()
      )
    ).toEqual({ processed: 1 })
    expect(repository.claim).toHaveBeenCalledTimes(1)
    expect(repository.claim).toHaveBeenCalledWith(
      ownerB,
      8,
      now,
      expect.any(String),
      "lease-token-0001"
    )
  })
})
