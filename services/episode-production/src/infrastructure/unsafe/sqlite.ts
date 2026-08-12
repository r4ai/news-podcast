import { DatabaseSync } from "node:sqlite"

export type StoredJobRow = Readonly<{
  requestFingerprint: string
  document: string
}>

export type LeasedJobRow = Readonly<{
  document: string
  recovered: boolean
}>

export type StoredCheckpointRow = Readonly<{
  script: string
  audio?: string
}>

export type StoredCompletionOutboxRow = Readonly<{
  episodeId: string
  payload: string
}>

export type SqliteJobHandle = Readonly<{
  findById: (jobId: string) => string | undefined
  saveIdempotently: (input: {
    readonly ownerId: string
    readonly idempotencyKey: string
    readonly requestFingerprint: string
    readonly jobId: string
    readonly document: string
  }) =>
    | { readonly _tag: "Inserted" }
    | { readonly _tag: "Existing"; readonly row: StoredJobRow }
  leaseNext: (input: {
    readonly now: string
    readonly replace: (document: string) => string
  }) => LeasedJobRow | undefined
  hasLease: (jobId: string, leaseToken: string) => boolean
  loadCheckpoint: (jobId: string) => StoredCheckpointRow | undefined
  saveScriptCheckpoint: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly script: string
  }) => boolean
  saveAudioCheckpoint: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly audio: string
  }) => "Applied" | "StaleLease" | "MissingScript"
  transition: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly document: string
  }) => boolean
  completeWithOutbox: (input: {
    readonly jobId: string
    readonly leaseToken: string
    readonly document: string
    readonly episodeId: string
    readonly payload: string
    readonly createdAt: string
  }) => "Applied" | "Duplicate" | "StaleLease"
  findCompletionOutbox: (jobId: string) => StoredCompletionOutboxRow | undefined
  close: () => void
}>

/** The mutable Node SQLite driver is confined to this interop module. */
export const openSqliteJobHandle = (databasePath: string): SqliteJobHandle => {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS episode_jobs (
      job_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      document TEXT NOT NULL,
      UNIQUE(owner_id, idempotency_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS episode_execution_checkpoints (
      job_id TEXT PRIMARY KEY REFERENCES episode_jobs(job_id) ON DELETE CASCADE,
      script TEXT NOT NULL,
      audio TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS episode_completion_outbox (
      job_id TEXT PRIMARY KEY REFERENCES episode_jobs(job_id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS episode_jobs_execution_state
      ON episode_jobs(json_extract(document, '$._tag'), job_id);
    CREATE INDEX IF NOT EXISTS episode_completion_outbox_pending
      ON episode_completion_outbox(published_at, created_at);
  `)

  const transaction = <Value>(body: () => Value): Value => {
    database.exec("BEGIN IMMEDIATE")
    try {
      const value = body()
      database.exec("COMMIT")
      return value
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  const findById = database.prepare(
    "SELECT document FROM episode_jobs WHERE job_id = ?"
  )
  const findByKey = database.prepare(`
    SELECT request_fingerprint, document
    FROM episode_jobs
    WHERE owner_id = ? AND idempotency_key = ?
  `)
  const insert = database.prepare(`
    INSERT INTO episode_jobs (
      job_id, owner_id, idempotency_key, request_fingerprint, document
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const findLeaseCandidate = database.prepare(`
    SELECT job_id, document,
      CASE WHEN json_extract(document, '$._tag') = 'Running' THEN 1 ELSE 0 END recovered
    FROM episode_jobs
    WHERE json_extract(document, '$._tag') = 'Queued'
      OR (
        json_extract(document, '$._tag') = 'Retrying'
        AND json_extract(document, '$.retryAt') <= ?
      )
      OR (
        json_extract(document, '$._tag') = 'Running'
        AND json_extract(document, '$.lease.leasedUntil') <= ?
      )
    ORDER BY CASE json_extract(document, '$._tag')
      WHEN 'Running' THEN 0
      WHEN 'Retrying' THEN 1
      ELSE 2
    END, job_id
    LIMIT 1
  `)
  const replaceJob = database.prepare(`
    UPDATE episode_jobs SET document = ? WHERE job_id = ?
  `)
  const hasLease = database.prepare(`
    SELECT 1 FROM episode_jobs
    WHERE job_id = ?
      AND json_extract(document, '$._tag') = 'Running'
      AND json_extract(document, '$.lease.token') = ?
  `)
  const loadCheckpoint = database.prepare(`
    SELECT script, audio FROM episode_execution_checkpoints WHERE job_id = ?
  `)
  const insertScriptCheckpoint = database.prepare(`
    INSERT INTO episode_execution_checkpoints(job_id, script, audio)
    VALUES (?, ?, NULL)
    ON CONFLICT(job_id) DO UPDATE SET script = excluded.script
  `)
  const updateAudioCheckpoint = database.prepare(`
    UPDATE episode_execution_checkpoints SET audio = ? WHERE job_id = ?
  `)
  const findCompletionOutbox = database.prepare(`
    SELECT episode_id, payload FROM episode_completion_outbox WHERE job_id = ?
  `)
  const insertCompletionOutbox = database.prepare(`
    INSERT INTO episode_completion_outbox(
      job_id, episode_id, payload, created_at, published_at
    ) VALUES (?, ?, ?, ?, NULL)
  `)

  return {
    findById: (jobId) =>
      (findById.get(jobId) as { readonly document: string } | undefined)
        ?.document,
    saveIdempotently: (input) => {
      return transaction(() => {
        const existing = findByKey.get(input.ownerId, input.idempotencyKey) as
          | {
              readonly request_fingerprint: string
              readonly document: string
            }
          | undefined
        if (existing) {
          return {
            _tag: "Existing",
            row: {
              requestFingerprint: existing.request_fingerprint,
              document: existing.document,
            },
          }
        }
        insert.run(
          input.jobId,
          input.ownerId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.document
        )
        return { _tag: "Inserted" }
      })
    },
    leaseNext: (input) =>
      transaction(() => {
        const candidate = findLeaseCandidate.get(input.now, input.now) as
          | {
              readonly job_id: string
              readonly document: string
              readonly recovered: number
            }
          | undefined
        if (candidate === undefined) return undefined
        const next = input.replace(candidate.document)
        replaceJob.run(next, candidate.job_id)
        return { document: next, recovered: candidate.recovered === 1 }
      }),
    hasLease: (jobId, leaseToken) =>
      hasLease.get(jobId, leaseToken) !== undefined,
    loadCheckpoint: (jobId) => {
      const row = loadCheckpoint.get(jobId) as
        | { readonly script: string; readonly audio: string | null }
        | undefined
      return row === undefined
        ? undefined
        : {
            script: row.script,
            ...(row.audio === null ? {} : { audio: row.audio }),
          }
    },
    saveScriptCheckpoint: (input) =>
      transaction(() => {
        if (hasLease.get(input.jobId, input.leaseToken) === undefined) {
          return false
        }
        insertScriptCheckpoint.run(input.jobId, input.script)
        return true
      }),
    saveAudioCheckpoint: (input) =>
      transaction(() => {
        if (hasLease.get(input.jobId, input.leaseToken) === undefined) {
          return "StaleLease"
        }
        return updateAudioCheckpoint.run(input.audio, input.jobId).changes === 1
          ? "Applied"
          : "MissingScript"
      }),
    transition: (input) =>
      transaction(() => {
        if (hasLease.get(input.jobId, input.leaseToken) === undefined) {
          return false
        }
        replaceJob.run(input.document, input.jobId)
        return true
      }),
    completeWithOutbox: (input) =>
      transaction(() => {
        const currentDocument = (
          findById.get(input.jobId) as { readonly document: string } | undefined
        )?.document
        if (currentDocument !== undefined) {
          const current = JSON.parse(currentDocument) as {
            readonly _tag?: unknown
            readonly episodeId?: unknown
          }
          const existing = findCompletionOutbox.get(input.jobId) as
            | { readonly episode_id: string; readonly payload: string }
            | undefined
          if (
            current._tag === "Succeeded" &&
            current.episodeId === input.episodeId &&
            existing?.episode_id === input.episodeId &&
            existing.payload === input.payload
          ) {
            return "Duplicate"
          }
        }
        if (hasLease.get(input.jobId, input.leaseToken) === undefined) {
          return "StaleLease"
        }
        replaceJob.run(input.document, input.jobId)
        insertCompletionOutbox.run(
          input.jobId,
          input.episodeId,
          input.payload,
          input.createdAt
        )
        return "Applied"
      }),
    findCompletionOutbox: (jobId) => {
      const row = findCompletionOutbox.get(jobId) as
        | { readonly episode_id: string; readonly payload: string }
        | undefined
      return row === undefined
        ? undefined
        : { episodeId: row.episode_id, payload: row.payload }
    },
    close: () => database.close(),
  }
}
