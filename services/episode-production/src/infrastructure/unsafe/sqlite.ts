import { DatabaseSync } from "node:sqlite"

export type StoredJobRow = Readonly<{
  requestFingerprint: string
  document: string
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
  close: () => void
}>

/** The mutable Node SQLite driver is confined to this interop module. */
export const openSqliteJobHandle = (databasePath: string): SqliteJobHandle => {
  const database = new DatabaseSync(databasePath)
  database.exec(`
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
  `)

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

  return {
    findById: (jobId) =>
      (findById.get(jobId) as { readonly document: string } | undefined)
        ?.document,
    saveIdempotently: (input) => {
      database.exec("BEGIN IMMEDIATE")
      try {
        const existing = findByKey.get(input.ownerId, input.idempotencyKey) as
          | {
              readonly request_fingerprint: string
              readonly document: string
            }
          | undefined
        if (existing) {
          database.exec("COMMIT")
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
        database.exec("COMMIT")
        return { _tag: "Inserted" }
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    close: () => database.close(),
  }
}
