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
    const requestHash = JSON.stringify({ trigger: command.trigger, feedIds })
    const record = await this.jobs.create({
      ownerId: command.ownerId,
      idempotencyKey,
      requestHash,
      trigger: command.trigger,
      feedIds,
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
