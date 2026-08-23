import { createHash } from "node:crypto"
import { access } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { DatabaseSync } from "node:sqlite"

export const databaseProfiles = Object.freeze([
  "identity",
  "content",
  "production",
  "library",
])

const fail = (message) => {
  throw new Error(message)
}

export const rejectGeneration = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  throw error
}

export const withSqliteWriteBarrier = async ({
  databaseSources,
  timeoutMillis,
  operation,
  monotonicNow = () => performance.now(),
}) => {
  if (!Number.isSafeInteger(timeoutMillis) || timeoutMillis <= 0) {
    fail("backup barrier timeout must be a positive integer")
  }
  if (typeof operation !== "function")
    fail("backup barrier operation is required")
  const startedAt = monotonicNow()
  const databases = []
  try {
    for (const profile of databaseProfiles) {
      const source = databaseSources?.[profile]
      if (typeof source !== "string") fail(`missing ${profile} database source`)
      await access(source)
      const remaining = Math.floor(timeoutMillis - (monotonicNow() - startedAt))
      if (remaining <= 0) {
        rejectGeneration(
          "barrier_timeout",
          `backup write barrier timed out before ${profile}`,
          { barrierDurationMillis: monotonicNow() - startedAt }
        )
      }
      const database = new DatabaseSync(source, { timeout: remaining })
      try {
        database.exec(`PRAGMA busy_timeout = ${remaining}; BEGIN IMMEDIATE`)
      } catch (error) {
        database.close()
        const reason =
          error?.code === "SQLITE_BUSY" || error?.code === "SQLITE_LOCKED"
            ? "barrier_timeout"
            : "barrier_acquisition"
        rejectGeneration(
          reason,
          `backup write barrier rejected at ${profile}: ${error instanceof Error ? error.message : String(error)}`,
          { barrierDurationMillis: monotonicNow() - startedAt }
        )
      }
      databases.push(database)
    }

    let value
    try {
      value = await operation()
    } catch (error) {
      if (
        error instanceof Error &&
        !Number.isFinite(error.barrierDurationMillis)
      ) {
        error.barrierDurationMillis = monotonicNow() - startedAt
      }
      throw error
    }
    const durationMillis = Math.max(0, monotonicNow() - startedAt)
    if (durationMillis > timeoutMillis) {
      rejectGeneration(
        "barrier_duration_exceeded",
        "backup write barrier exceeded its bounded duration",
        { barrierDurationMillis: durationMillis }
      )
    }
    return { value, durationMillis: Math.round(durationMillis) }
  } finally {
    for (const database of databases.toReversed()) {
      try {
        database.exec("ROLLBACK")
      } finally {
        database.close()
      }
    }
  }
}

const sha256 = (input) => createHash("sha256").update(input).digest("hex")

const completionPayloadFingerprint = (envelope) => {
  const payload = envelope?.payload
  if (
    envelope?.messageId === undefined ||
    typeof payload?.episodeId !== "string" ||
    typeof payload?.ownerId !== "string" ||
    typeof payload?.title !== "string" ||
    typeof payload?.script !== "string" ||
    typeof payload?.completedAt !== "string" ||
    typeof payload?.audio?.objectKey !== "string" ||
    !Number.isSafeInteger(payload?.audio?.byteLength) ||
    typeof payload?.audio?.contentType !== "string" ||
    !Array.isArray(payload?.sources)
  ) {
    rejectGeneration(
      "cross_service_invariant",
      "cross-service invariant rejected an invalid completion outbox payload"
    )
  }
  const sources = payload.sources.map((source) => ({
    _tag: "RssSource",
    ...(source.articleId === undefined ? {} : { articleId: source.articleId }),
    url: source.url,
    title: source.title,
    ...(source.publishedAt === undefined
      ? {}
      : { publishedAt: source.publishedAt }),
    snapshotId: source.snapshotId,
  }))
  return sha256(
    JSON.stringify({
      id: payload.episodeId,
      ownerId: payload.ownerId,
      title: payload.title,
      script: payload.script,
      audio: payload.audio,
      sources,
      createdAt: payload.completedAt,
    })
  )
}

const crossServiceFailure = (jobId, reason) =>
  rejectGeneration(
    "cross_service_invariant",
    `cross-service invariant rejected job ${jobId}: ${reason}`
  )

const storedEpisodeFingerprint = (episode, sources) =>
  sha256(
    JSON.stringify({
      id: episode.id,
      ownerId: episode.owner_id,
      title: episode.title,
      script: episode.script,
      audio: {
        objectKey: episode.audio_object_key,
        byteLength: episode.audio_byte_length,
        contentType: episode.audio_content_type,
      },
      sources: sources.map((source) =>
        source.source_kind === "rss"
          ? {
              _tag: "RssSource",
              ...(source.article_id === null
                ? {}
                : { articleId: source.article_id }),
              url: source.url,
              title: source.title,
              ...(source.published_at === null
                ? {}
                : { publishedAt: source.published_at }),
              snapshotId: source.snapshot_id,
            }
          : { _tag: "WebSource", url: source.url, title: source.title }
      ),
      createdAt: episode.created_at,
    })
  )

export const assertCrossServiceState = (databasePaths) => {
  let production
  let library
  try {
    production = new DatabaseSync(databasePaths.production, { readOnly: true })
    library = new DatabaseSync(databasePaths.library, { readOnly: true })
    const jobs = new Map(
      production
        .prepare(
          "SELECT job_id, status, episode_id, completed_at FROM episode_jobs"
        )
        .all()
        .map((row) => [row.job_id, row])
    )
    const outboxes = new Map(
      production
        .prepare(
          "SELECT job_id, episode_id, payload, published_at FROM episode_completion_outbox"
        )
        .all()
        .map((row) => [row.job_id, row])
    )
    const inboxes = new Map(
      library
        .prepare(
          "SELECT message_id, episode_id, payload_hash FROM episode_completion_inbox"
        )
        .all()
        .map((row) => [row.message_id, row])
    )
    const episodes = new Map(
      library
        .prepare(
          "SELECT id, owner_id, title, script, audio_object_key, audio_byte_length, audio_content_type, created_at FROM episodes"
        )
        .all()
        .map((row) => [row.id, row])
    )
    const sourcesByEpisode = new Map()
    for (const source of library
      .prepare(
        "SELECT episode_id, position, source_kind, article_id, url, title, published_at, snapshot_id FROM episode_sources ORDER BY episode_id, position"
      )
      .all()) {
      const sources = sourcesByEpisode.get(source.episode_id) ?? []
      sources.push(source)
      sourcesByEpisode.set(source.episode_id, sources)
    }

    for (const job of jobs.values()) {
      if (job.status === "Succeeded") {
        const outbox = outboxes.get(job.job_id)
        if (!outbox)
          crossServiceFailure(job.job_id, "succeeded job has no outbox")
        if (job.episode_id !== outbox.episode_id) {
          crossServiceFailure(job.job_id, "job and outbox episode IDs differ")
        }
      }
    }

    for (const outbox of outboxes.values()) {
      const job = jobs.get(outbox.job_id)
      if (
        job?.status !== "Succeeded" ||
        job.episode_id !== outbox.episode_id ||
        job.completed_at === null
      ) {
        crossServiceFailure(
          outbox.job_id,
          "outbox has no matching succeeded job"
        )
      }
      let envelope
      try {
        envelope = JSON.parse(outbox.payload)
      } catch {
        crossServiceFailure(outbox.job_id, "outbox payload is invalid JSON")
      }
      if (
        envelope.messageId !== outbox.job_id ||
        envelope.payload?.episodeId !== outbox.episode_id
      ) {
        crossServiceFailure(outbox.job_id, "outbox envelope identity differs")
      }
      const inbox = inboxes.get(outbox.job_id)
      if (outbox.published_at !== null && !inbox) {
        crossServiceFailure(
          outbox.job_id,
          "published completion is not materialized in Library"
        )
      }
      if (
        inbox &&
        (inbox.episode_id !== outbox.episode_id ||
          inbox.payload_hash !== completionPayloadFingerprint(envelope))
      ) {
        crossServiceFailure(outbox.job_id, "Library inbox payload differs")
      }
    }

    const inboxEpisodeIds = new Set()
    for (const inbox of inboxes.values()) {
      const outbox = outboxes.get(inbox.message_id)
      if (!outbox || outbox.episode_id !== inbox.episode_id) {
        crossServiceFailure(
          inbox.message_id,
          "Library inbox is ahead of Production"
        )
      }
      const episode = episodes.get(inbox.episode_id)
      if (!episode) {
        crossServiceFailure(inbox.message_id, "Library inbox has no Episode")
      }
      if (
        storedEpisodeFingerprint(
          episode,
          sourcesByEpisode.get(inbox.episode_id) ?? []
        ) !== inbox.payload_hash
      ) {
        crossServiceFailure(
          inbox.message_id,
          "Library Episode payload differs from its inbox"
        )
      }
      inboxEpisodeIds.add(inbox.episode_id)
    }
    for (const episodeId of episodes.keys()) {
      if (!inboxEpisodeIds.has(episodeId)) {
        crossServiceFailure(
          episodeId,
          "Library Episode has no completion inbox"
        )
      }
    }
  } catch (error) {
    if (error?.code === "cross_service_invariant") throw error
    rejectGeneration(
      "cross_service_invariant",
      `cross-service invariant could not be verified: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    production?.close()
    library?.close()
  }
}
