import { validateIdempotencyKey } from "@news-podcast/domain"

import type {
  EnabledSubscriptionReader,
  EpisodeJobRecord,
  EpisodeJobRepository,
  JobDispatcher,
} from "./ports.js"

export interface CreateEpisodeJobCommand {
  readonly ownerId: string
  readonly idempotencyKey: string
  readonly trigger: "manual" | "scheduled"
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
    })

    if (record.created) {
      await this.dispatcher.dispatch({
        ownerId: record.ownerId,
        jobId: record.jobId,
      })
    }

    return record
  }
}
