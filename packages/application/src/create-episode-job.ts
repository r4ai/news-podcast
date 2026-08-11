import { validateIdempotencyKey } from "@news-podcast/domain"

import type {
  EnabledSubscriptionReader,
  EpisodeJobRecord,
  EpisodeJobRepository,
  EpisodeTraceContext,
  JobDispatcher,
} from "./ports.js"

export interface CreateEpisodeJobCommand {
  readonly ownerId: string
  readonly idempotencyKey: string
  readonly trigger: "manual" | "scheduled"
  /** 明示選択された記事。省略時は購読フィード全体からの全自動選択。 */
  readonly articleIds?: readonly string[]
  readonly traceContext?: EpisodeTraceContext
}

export class CreateEpisodeJob {
  constructor(
    private readonly subscriptions: EnabledSubscriptionReader,
    private readonly jobs: EpisodeJobRepository,
    private readonly dispatcher: JobDispatcher
  ) {}

  async execute(command: CreateEpisodeJobCommand): Promise<EpisodeJobRecord> {
    const idempotencyKey = validateIdempotencyKey(command.idempotencyKey)
    const feedIds = await this.subscriptions.listEnabledFeedIds(command.ownerId)
    // 選択記事は生成結果を決定づけるので requestHash に含める。含めないと、
    // 同じ冪等キーで別の選択を投げたときに黙って前回のジョブが返ってしまう。
    const articleIds = command.articleIds ? [...command.articleIds].sort() : []
    const requestHash = JSON.stringify({
      trigger: command.trigger,
      feedIds,
      articleIds,
    })
    const record = await this.jobs.create({
      ownerId: command.ownerId,
      idempotencyKey,
      requestHash,
      trigger: command.trigger,
      feedIds,
      ...(command.articleIds ? { articleIds: command.articleIds } : {}),
      ...(command.traceContext ? { traceContext: command.traceContext } : {}),
    })

    if (record.created) {
      await this.dispatcher.dispatch({
        ownerId: record.ownerId,
        jobId: record.jobId,
        ...(command.traceContext ? { traceContext: command.traceContext } : {}),
      })
    }

    return record
  }
}
