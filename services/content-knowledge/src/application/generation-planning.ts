import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArticleId } from "../domain/article.js"
import type { InterestProfile } from "../domain/interest-profile.js"
import type { OwnerId } from "../domain/subscription.js"
import type {
  ArticleCatalog,
  GenerationCandidate,
} from "./ports/article-catalog.js"

export type ArticleSelectionFailure = DeepReadonly<{
  readonly _tag: "ArticleSelectionFailed"
  readonly reason: "ProviderFailure" | "InvalidSelection"
}>

export type ArticleSelector = DeepReadonly<{
  readonly model: string
  readonly select: (input: {
    readonly interestProfile: InterestProfile
    readonly candidates: readonly GenerationCandidate[]
  }) => Effect.Effect<readonly ArticleId[], ArticleSelectionFailure>
}>

export type GenerationPlanDraft = DeepReadonly<{
  readonly interestProfile: InterestProfile
  readonly selectedArticleIds: readonly [ArticleId, ...ArticleId[]]
  readonly model: string
}>

export type GenerationPlanningResult = DeepReadonly<
  | { readonly _tag: "Planned"; readonly plan: GenerationPlanDraft }
  | { readonly _tag: "NoCandidates" }
>

export type GenerationPlanningSelection = DeepReadonly<
  | { readonly _tag: "Automatic" }
  | {
      readonly _tag: "Manual"
      readonly articleIds: readonly [ArticleId, ...ArticleId[]]
    }
>

const isEmptyProfile = (profile: InterestProfile): boolean =>
  profile.include.trim() === "" && profile.exclude.trim() === ""

/** Round-robin by source while preserving each source's recency order. */
export const deterministicSelection = (
  candidates: readonly GenerationCandidate[],
  maximum = 20
): readonly ArticleId[] => {
  const bySource = new Map<string, GenerationCandidate[]>()
  for (const candidate of candidates) {
    const queue = bySource.get(candidate.sourceName) ?? []
    queue.push(candidate)
    bySource.set(candidate.sourceName, queue)
  }
  const selected: ArticleId[] = []
  for (let index = 0; selected.length < maximum; index += 1) {
    let appended = false
    for (const queue of bySource.values()) {
      const candidate = queue[index]
      if (candidate === undefined) continue
      selected.push(candidate.articleId)
      appended = true
      if (selected.length === maximum) break
    }
    if (!appended) break
  }
  return deepFreeze(selected)
}

export const createGenerationPlanning = (ports: {
  readonly catalog: Pick<ArticleCatalog, "listGenerationCandidates">
  readonly interestProfiles: {
    readonly get: (ownerId: OwnerId) => Effect.Effect<InterestProfile, unknown>
  }
  readonly selector: ArticleSelector
}) =>
  Effect.fn("contentKnowledge.generationPlanning")(function* (
    ownerId: OwnerId,
    selection: GenerationPlanningSelection = { _tag: "Automatic" }
  ) {
    const interestProfile = yield* ports.interestProfiles.get(ownerId)
    if (selection._tag === "Manual") {
      return deepFreeze({
        _tag: "Planned" as const,
        plan: {
          interestProfile,
          selectedArticleIds: selection.articleIds,
          model: "manual-selection-v1",
        },
      })
    }
    const candidates = yield* ports.catalog.listGenerationCandidates(
      ownerId,
      50
    )
    if (candidates.length === 0) {
      return deepFreeze({ _tag: "NoCandidates" as const })
    }
    const selected = isEmptyProfile(interestProfile)
      ? deterministicSelection(candidates)
      : yield* ports.selector.select({ interestProfile, candidates })
    const allowed = new Set(candidates.map((candidate) => candidate.articleId))
    if (
      selected.length < 1 ||
      selected.length > 20 ||
      new Set(selected).size !== selected.length ||
      selected.some((articleId) => !allowed.has(articleId))
    ) {
      return yield* Effect.fail<ArticleSelectionFailure>(
        deepFreeze({
          _tag: "ArticleSelectionFailed",
          reason: "InvalidSelection",
        })
      )
    }
    const [first, ...rest] = selected
    return deepFreeze({
      _tag: "Planned" as const,
      plan: {
        interestProfile,
        selectedArticleIds: [first!, ...rest],
        model: isEmptyProfile(interestProfile)
          ? "deterministic-recency-v1"
          : ports.selector.model,
      },
    })
  })
