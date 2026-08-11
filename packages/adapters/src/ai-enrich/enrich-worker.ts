import type {
  ArticleRelevanceScorer,
  ArticleSummarizer,
  InterestProfile,
  ObjectStore,
} from "@news-podcast/application"

import type { LocalStore } from "../db/local-store.js"
import {
  computeProfileHash,
  DEFAULT_AI_ENRICH_DAILY_LIMIT,
  ProviderRateLimitError,
  RELEVANCE_BATCH_SIZE,
} from "./shared.js"

// 1ownerあたり1tickで処理する候補件数の上限。日次上限とは別に、1tickが
// 特定ownerに独占されないようスコアリングのバッチサイズと揃える。
const MAX_CANDIDATES_PER_OWNER_PER_TICK = RELEVANCE_BATCH_SIZE

interface EnrichCandidate {
  readonly feedItemId: string
  readonly title: string
  readonly snapshotId: string
  readonly markdownKey: string
}

// packages/adapters は @news-podcast/observability に依存しない方針
// （LocalStore/ArticleArchiverと同じ）。トークン計上や成否ログは呼び出し側
// （apps/worker, apps/api）が持つObservabilityへ、このイベント通知経由で渡す。
export type AiEnrichEvent =
  | {
      readonly type: "summary_succeeded"
      readonly tokensIn: number
      readonly tokensOut: number
    }
  | {
      readonly type: "summary_failed"
      readonly error: unknown
      readonly rateLimited: boolean
    }
  | {
      readonly type: "relevance_succeeded"
      readonly count: number
      readonly tokensIn: number
      readonly tokensOut: number
    }
  | {
      readonly type: "relevance_failed"
      readonly count: number
      readonly error: unknown
      readonly rateLimited: boolean
    }

// RSS記事へのAI補助（日本語要約＋適合度スコア）をenrich_queueから優先度順で
// 日次上限つきで処理するワーカー。要約は記事本文単位（所有者非依存）でキャッシュし、
// スコアはowner+記事単位でタイトル・要約だけを使って5〜10件ずつまとめて
// 1コールにする（コストの主眼はここ）。
export class AiEnrichWorker {
  constructor(
    private readonly store: LocalStore,
    private readonly objects: ObjectStore,
    private readonly summarizer: ArticleSummarizer,
    private readonly scorer: ArticleRelevanceScorer,
    private readonly model: string,
    private readonly dailyLimit: number = DEFAULT_AI_ENRICH_DAILY_LIMIT,
    private readonly onEvent: (event: AiEnrichEvent) => void = () => {}
  ) {}

  async runOnce(now = new Date()): Promise<void> {
    // 未処理記事の自動投入と期限切れleaseの回収。日次上限を使い切っていても
    // 実行し、次の日の最初のtickで滞留したprocessingを回収できるようにする。
    this.store.reconcileEnrichQueue(now)
    const localDate = toLocalDate(now)
    let processed = this.store.getEnrichProcessedToday(localDate)
    if (processed >= this.dailyLimit) return
    for (const ownerId of this.store.listOwnersWithSubscriptions()) {
      if (processed >= this.dailyLimit) break
      const remaining = Math.min(
        this.dailyLimit - processed,
        MAX_CANDIDATES_PER_OWNER_PER_TICK
      )
      processed += await this.enrichOwner(ownerId, localDate, remaining, now)
    }
  }

  // POST /v1/me/articles/{id}/enrich が呼ぶオンデマンド再処理。日次上限は
  // 適用しない（利用者が明示的に要求した単発の再計算のため）。
  // 戻り値はtrueなら再計算成功、falseならアーカイブ未完了などで対象外。
  async enrichOne(ownerId: string, feedItemId: string): Promise<boolean> {
    const target = this.store.getEnrichTarget(ownerId, feedItemId)
    if (!target) return false
    const profile = this.store.getInterestProfile(ownerId)
    const profileHash = computeProfileHash(profile.include, profile.exclude)
    const bullets = await this.ensureSummary(target, true)
    if (!bullets) return false
    const result = await this.scoreBatch(
      ownerId,
      profile,
      profileHash,
      [target],
      new Map([[target.feedItemId, bullets]]),
      true
    )
    if (result.succeeded.length > 0) {
      // 未処理のままqueueに残っていた場合は成功として片付ける。
      // これにより、オンデマンド処理後もバッチが二重スコアリングしない。
      this.store.completeEnrichBatch(ownerId, {
        succeeded: [feedItemId],
        failed: [],
      })
    }
    return result.succeeded.length > 0
  }

  private async enrichOwner(
    ownerId: string,
    localDate: string,
    limit: number,
    now: Date
  ): Promise<number> {
    if (limit <= 0) return 0
    const profile = this.store.getInterestProfile(ownerId)
    const profileHash = computeProfileHash(profile.include, profile.exclude)
    const batch = this.store.leaseEnrichBatch(ownerId, limit, now)
    if (batch.length === 0) return 0

    const bulletsByFeedItem = new Map<string, readonly string[]>()
    const failed: { readonly feedItemId: string; readonly error: string }[] = []
    for (const candidate of batch) {
      try {
        const bullets = await this.ensureSummary(candidate)
        if (bullets) {
          bulletsByFeedItem.set(candidate.feedItemId, bullets)
        } else {
          failed.push({
            feedItemId: candidate.feedItemId,
            error: "summary-unavailable",
          })
        }
      } catch (error) {
        failed.push({
          feedItemId: candidate.feedItemId,
          error:
            error instanceof Error ? error.message : "summary-failed",
        })
      }
    }
    const scorable = batch.filter((candidate) =>
      bulletsByFeedItem.has(candidate.feedItemId)
    )

    const succeeded: string[] = []
    for (const batchItem of chunk(scorable, RELEVANCE_BATCH_SIZE)) {
      const result = await this.scoreBatch(
        ownerId,
        profile,
        profileHash,
        batchItem,
        bulletsByFeedItem
      )
      succeeded.push(...result.succeeded)
      failed.push(...result.failed)
    }
    this.store.completeEnrichBatch(
      ownerId,
      { succeeded, failed },
      now
    )
    if (succeeded.length > 0) {
      this.store.incrementEnrichProcessed(localDate, succeeded.length)
    }
    return succeeded.length
  }

  // 既存の要約（現行prompt_version）があれば再利用し、無ければ1記事1コールで生成する。
  private async ensureSummary(
    candidate: EnrichCandidate,
    rethrowFailure = false
  ): Promise<readonly string[] | undefined> {
    const existing = this.store.getArticleSummary(candidate.snapshotId)
    if (existing) return existing
    try {
      const object = await this.objects.get(candidate.markdownKey)
      const markdown = object ? new TextDecoder().decode(object.body) : ""
      const result = await this.summarizer.summarize({
        title: candidate.title,
        markdown,
      })
      this.store.saveArticleSummary({
        snapshotId: candidate.snapshotId,
        model: this.model,
        bullets: result.bullets,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      this.onEvent({
        type: "summary_succeeded",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      return result.bullets
    } catch (error) {
      this.onEvent({
        type: "summary_failed",
        error,
        rateLimited: error instanceof ProviderRateLimitError,
      })
      if (rethrowFailure) throw error
      return undefined
    }
  }

  // タイトル＋要約だけを使い、候補をまとめて1コールでスコア付けする。
  // 戻り値は成功したfeedItemIdと失敗したfeedItemId+errorの組。呼び出し側
  // （enrichOwner/enrichOne）がenrich_queueへ成否を反映する。
  private async scoreBatch(
    ownerId: string,
    profile: InterestProfile,
    profileHash: string,
    batch: readonly EnrichCandidate[],
    bulletsByFeedItem: ReadonlyMap<string, readonly string[]>,
    rethrowFailure = false
  ): Promise<{
    readonly succeeded: readonly string[]
    readonly failed: readonly { readonly feedItemId: string; readonly error: string }[]
  }> {
    try {
      // タグ付与はこのスコア付けコールに相乗りさせる（新規コールは増やさない）。
      // 語彙が空のときはscorer側がtags関連フィールドをスキーマから外すため、
      // ここでは常に現在の語彙をそのまま渡すだけでよい。
      const tagVocabulary = this.store.getTagVocabulary(ownerId)
      const result = await this.scorer.score({
        profile,
        candidates: batch.map((candidate) => ({
          feedItemId: candidate.feedItemId,
          title: candidate.title,
          bullets: bulletsByFeedItem.get(candidate.feedItemId) ?? [],
        })),
        tagVocabulary,
      })
      const perItem = splitTokensEvenly(
        result.tokensIn,
        result.tokensOut,
        result.scores.length
      )
      result.scores.forEach((score, index) => {
        this.store.saveArticleRelevance({
          ownerId,
          feedItemId: score.feedItemId,
          profileHash,
          model: this.model,
          score: score.score,
          reason: score.reason,
          tokensIn: perItem[index]!.tokensIn,
          tokensOut: perItem[index]!.tokensOut,
        })
        // AI付与タグは語彙内のみ（confidenceは選択式のため固定値=1で「選ばれた」を表す）。
        if (score.tags.length > 0) {
          this.store.saveAiArticleTags(
            ownerId,
            score.feedItemId,
            score.tags.map((name) => ({ name, confidence: 1 }))
          )
        }
        if (score.suggestedTags.length > 0) {
          this.store.recordTagSuggestions(ownerId, score.suggestedTags)
        }
      })
      this.onEvent({
        type: "relevance_succeeded",
        count: result.scores.length,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      return {
        succeeded: result.scores.map((score) => score.feedItemId),
        failed: [],
      }
    } catch (error) {
      this.onEvent({
        type: "relevance_failed",
        count: batch.length,
        error,
        rateLimited: error instanceof ProviderRateLimitError,
      })
      const message =
        error instanceof Error ? error.message : "Relevance scoring failed"
      const failed = batch.map((candidate) => ({
        feedItemId: candidate.feedItemId,
        error: message.slice(0, 500),
      }))
      for (const item of failed) {
        this.store.saveArticleRelevanceFailure({
          ownerId,
          feedItemId: item.feedItemId,
          profileHash,
          model: this.model,
          error: item.error,
        })
      }
      if (rethrowFailure) throw error
      return { succeeded: [], failed }
    }
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

// バッチ呼び出しのトークン使用量を各記事へ均等割りする（端数は最後の記事へ寄せる）。
// 合計が常にAPIの報告値と一致するようにするための素朴な配分。
function splitTokensEvenly(
  tokensIn: number,
  tokensOut: number,
  count: number
): { readonly tokensIn: number; readonly tokensOut: number }[] {
  if (count === 0) return []
  const baseIn = Math.floor(tokensIn / count)
  const baseOut = Math.floor(tokensOut / count)
  return Array.from({ length: count }, (_, index) => {
    const isLast = index === count - 1
    return {
      tokensIn: isLast ? tokensIn - baseIn * (count - 1) : baseIn,
      tokensOut: isLast ? tokensOut - baseOut * (count - 1) : baseOut,
    }
  })
}

function toLocalDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}
