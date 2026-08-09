import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import type {
  JobLeaseStore,
  LeasedEpisodeJob,
} from "@news-podcast/application"

interface JobRow {
  readonly id: string
  readonly owner_id: string
}

export class SqliteJobLeaseStore implements JobLeaseStore {
  constructor(private readonly database: DatabaseSync) {}

  leaseNext(now: Date, leaseSeconds: number): Promise<LeasedEpisodeJob | null> {
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const row = this.database
        .prepare(
          `SELECT id, owner_id FROM episode_jobs
           WHERE status = 'queued'
             AND available_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY created_at, id
           LIMIT 1`,
        )
        .get(now.toISOString(), now.toISOString()) as JobRow | undefined

      if (!row) {
        this.database.exec("COMMIT")
        return Promise.resolve(null)
      }

      this.database
        .prepare(
          `UPDATE episode_jobs
           SET status = 'running', started_at = COALESCE(started_at, ?),
               lease_token = ?, lease_expires_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(now.toISOString(), leaseToken, leaseExpiresAt, row.id)
      this.database.exec("COMMIT")
      return Promise.resolve({
        ownerId: row.owner_id,
        jobId: row.id,
        status: "running",
        leaseToken,
      })
    } catch (error) {
      this.database.exec("ROLLBACK")
      return Promise.reject(error)
    }
  }
}
