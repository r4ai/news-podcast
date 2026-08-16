import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  createGenerationPlanning,
  deterministicSelection,
} from "./generation-planning.js"

const candidates = [
  {
    articleId: "5af55f2e-ff0b-475c-866a-f2cff48c1001",
    title: "A1",
    sourceName: "a.example",
    publishedAt: "2026-08-16T00:00:00.000Z",
    tags: ["AI"],
  },
  {
    articleId: "5af55f2e-ff0b-475c-866a-f2cff48c1002",
    title: "A2",
    sourceName: "a.example",
    tags: [],
  },
  {
    articleId: "5af55f2e-ff0b-475c-866a-f2cff48c1003",
    title: "B1",
    sourceName: "b.example",
    tags: [],
  },
] as never

describe("generation planning", () => {
  it("uses deterministic cross-source recency and skips the model for an empty profile", async () => {
    const select = vi.fn(() => Effect.succeed([] as never))
    const plan = createGenerationPlanning({
      catalog: { listGenerationCandidates: () => Effect.succeed(candidates) },
      interestProfiles: {
        get: () => Effect.succeed({ include: "", exclude: "" }),
      },
      selector: { model: "gpt-test", select },
    })

    const result = await Effect.runPromise(plan("owner" as never))

    expect(result).toMatchObject({
      _tag: "Planned",
      plan: {
        model: "deterministic-recency-v1",
        selectedArticleIds: [
          "5af55f2e-ff0b-475c-866a-f2cff48c1001",
          "5af55f2e-ff0b-475c-866a-f2cff48c1003",
          "5af55f2e-ff0b-475c-866a-f2cff48c1002",
        ],
      },
    })
    expect(select).not.toHaveBeenCalled()
  })

  it("loads the latest profile once and validates the ordered model selection", async () => {
    const get = vi.fn(() => Effect.succeed({ include: "AI", exclude: "広告" }))
    const select = vi.fn(() =>
      Effect.succeed([
        "5af55f2e-ff0b-475c-866a-f2cff48c1003",
        "5af55f2e-ff0b-475c-866a-f2cff48c1001",
      ] as never)
    )
    const plan = createGenerationPlanning({
      catalog: { listGenerationCandidates: () => Effect.succeed(candidates) },
      interestProfiles: { get },
      selector: { model: "gpt-test", select },
    })

    const result = await Effect.runPromise(plan("owner" as never))

    expect(result).toMatchObject({
      _tag: "Planned",
      plan: {
        interestProfile: { include: "AI", exclude: "広告" },
        selectedArticleIds: [
          "5af55f2e-ff0b-475c-866a-f2cff48c1003",
          "5af55f2e-ff0b-475c-866a-f2cff48c1001",
        ],
        model: "gpt-test",
      },
    })
    expect(get).toHaveBeenCalledOnce()
    expect(select).toHaveBeenCalledOnce()
  })

  const invalidSelections = [
    [],
    [
      "5af55f2e-ff0b-475c-866a-f2cff48c1001",
      "5af55f2e-ff0b-475c-866a-f2cff48c1001",
    ],
    ["5af55f2e-ff0b-475c-866a-f2cff48c1099"],
  ] as const

  it.each(invalidSelections.map((selected) => [selected] as const))(
    "rejects an invalid model selection",
    async (selected) => {
      const plan = createGenerationPlanning({
        catalog: { listGenerationCandidates: () => Effect.succeed(candidates) },
        interestProfiles: {
          get: () => Effect.succeed({ include: "AI", exclude: "" }),
        },
        selector: {
          model: "gpt-test",
          select: () => Effect.succeed(selected as never),
        },
      })

      const failure = await Effect.runPromise(
        Effect.flip(plan("owner" as never))
      )

      expect(failure).toEqual({
        _tag: "ArticleSelectionFailed",
        reason: "InvalidSelection",
      })
    }
  )

  it("returns NoCandidates without invoking the selector", async () => {
    const select = vi.fn(() => Effect.succeed([] as never))
    const plan = createGenerationPlanning({
      catalog: { listGenerationCandidates: () => Effect.succeed([]) },
      interestProfiles: {
        get: () => Effect.succeed({ include: "AI", exclude: "" }),
      },
      selector: { model: "gpt-test", select },
    })

    await expect(Effect.runPromise(plan("owner" as never))).resolves.toEqual({
      _tag: "NoCandidates",
    })
    expect(select).not.toHaveBeenCalled()
  })

  it("keeps every manual article and never invokes candidates or the selector", async () => {
    const listGenerationCandidates = vi.fn(() => Effect.succeed(candidates))
    const select = vi.fn(() => Effect.succeed([] as never))
    const plan = createGenerationPlanning({
      catalog: { listGenerationCandidates },
      interestProfiles: {
        get: () => Effect.succeed({ include: "AI", exclude: "広告" }),
      },
      selector: { model: "gpt-test", select },
    })
    const articleIds = [
      "5af55f2e-ff0b-475c-866a-f2cff48c1002",
      "5af55f2e-ff0b-475c-866a-f2cff48c1001",
    ] as never

    const result = await Effect.runPromise(
      plan("owner" as never, { _tag: "Manual", articleIds })
    )

    expect(result).toMatchObject({
      _tag: "Planned",
      plan: { selectedArticleIds: articleIds, model: "manual-selection-v1" },
    })
    expect(listGenerationCandidates).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })
})

describe("deterministicSelection", () => {
  it("is capped at twenty", () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      articleId: `id-${index}`,
      title: `article-${index}`,
      sourceName: `source-${index % 3}`,
      tags: [],
    })) as never
    expect(deterministicSelection(many)).toHaveLength(20)
  })
})
