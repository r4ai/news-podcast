import type { InterestProfile } from "@/features/settings"

export type InterestProfileDraft = {
  readonly include: string
  readonly exclude: string
}

export function toDraft(profile: InterestProfile): InterestProfileDraft {
  return { include: profile.include, exclude: profile.exclude }
}

// サーバ側の上限(schemas.ts InterestProfileSchema)と揃える。
export const INTEREST_PROFILE_MAX_LENGTH = 2_000

export function isSubmittable(draft: InterestProfileDraft): boolean {
  return (
    draft.include.length <= INTEREST_PROFILE_MAX_LENGTH &&
    draft.exclude.length <= INTEREST_PROFILE_MAX_LENGTH
  )
}

/** 保存前に「N件のスコアを再計算しますか」で見せる対象件数。全記事数をそのまま使う。 */
export function recomputeTargetCount(
  totalArticles: number | undefined
): number {
  return totalArticles ?? 0
}
