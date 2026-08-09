import type { EpisodeJobMessage } from "@news-podcast/application"

interface CloudflareBindings {
  readonly DB: D1Database
  readonly AUDIO: R2Bucket
}

export default {
  async queue(
    batch: MessageBatch<EpisodeJobMessage>,
    _env: CloudflareBindings
  ): Promise<void> {
    // The functional processor is intentionally gated. Retry messages rather
    // than acknowledging work that has not been durably processed.
    for (const message of batch.messages) {
      message.retry()
    }
  },
} satisfies ExportedHandler<CloudflareBindings, EpisodeJobMessage>
