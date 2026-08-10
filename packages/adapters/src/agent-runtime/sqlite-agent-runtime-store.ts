import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type {
  AgentEvent,
  AgentMemoryRecord,
  AgentMemoryRepository,
  AgentRunRecord,
  AgentRunRepository,
} from "@news-podcast/application"
import {
  initialMemoryStatus,
  transitionAgentRun,
  type AgentMemoryKind,
  type AgentMemoryStatus,
  type AgentRunStatus,
} from "@news-podcast/domain"

export interface AgentInstanceRecord {
  readonly id: string
  readonly ownerId: string
  readonly agentKey: string
  readonly createdAt: Date
}

export class SqliteAgentRuntimeStore
  implements AgentMemoryRepository, AgentRunRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async ensureInstance(
    ownerId: string,
    agentKey: string
  ): Promise<AgentInstanceRecord> {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `INSERT INTO agent_instances (id, owner_id, agent_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, agent_key) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run(randomUUID(), ownerId, agentKey, now, now)
    const row = this.database
      .prepare(
        `SELECT id, owner_id, agent_key, created_at FROM agent_instances
         WHERE owner_id = ? AND agent_key = ?`
      )
      .get(ownerId, agentKey)
    return toAgentInstance(row)
  }

  listInstances(ownerId: string): readonly AgentInstanceRecord[] {
    return this.database
      .prepare(
        `SELECT id, owner_id, agent_key, created_at FROM agent_instances
         WHERE owner_id = ? ORDER BY created_at, id`
      )
      .all(ownerId)
      .map(toAgentInstance)
  }

  listMemories(
    ownerId: string,
    agentInstanceId: string
  ): readonly AgentMemoryRecord[] {
    return this.database
      .prepare(
        `SELECT m.*, v.content_json
         FROM agent_memories m
         JOIN agent_memory_versions v
           ON v.memory_id = m.id AND v.version = m.current_version
         WHERE m.owner_id = ? AND m.agent_instance_id = ?
           AND m.status != 'deleted'
         ORDER BY m.created_at, m.id`
      )
      .all(ownerId, agentInstanceId)
      .map(toAgentMemory)
  }

  deleteMemory(
    ownerId: string,
    agentInstanceId: string,
    memoryId: string
  ): boolean {
    return (
      this.database
        .prepare(
          `UPDATE agent_memories SET status = 'deleted', updated_at = ?
           WHERE id = ? AND owner_id = ? AND agent_instance_id = ?
             AND status != 'deleted'`
        )
        .run(new Date().toISOString(), memoryId, ownerId, agentInstanceId)
        .changes === 1
    )
  }

  listEvents(ownerId: string, runId: string): readonly AgentEvent[] | null {
    const run = this.database
      .prepare("SELECT 1 FROM agent_runs WHERE id = ? AND owner_id = ?")
      .get(runId, ownerId)
    if (!run) return null
    return this.database
      .prepare(
        `SELECT sequence, event_type, payload_json, occurred_at
         FROM agent_events WHERE agent_run_id = ? ORDER BY sequence`
      )
      .all(runId)
      .map((row) => {
        const value = row as Record<string, unknown>
        const payload = JSON.parse(String(value.payload_json)) as Record<
          string,
          unknown
        >
        delete payload.schemaVersion
        return {
          schemaVersion: 1 as const,
          runId,
          sequence: Number(value.sequence),
          type: String(value.event_type),
          occurredAt: new Date(String(value.occurred_at)),
          payload,
        }
      })
  }

  async listActive(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
  }): Promise<readonly AgentMemoryRecord[]> {
    return this.database
      .prepare(
        `SELECT m.*, v.content_json
         FROM agent_memories m
         JOIN agent_memory_versions v
           ON v.memory_id = m.id AND v.version = m.current_version
         WHERE m.owner_id = ? AND m.agent_instance_id = ?
           AND m.status = 'active'
           AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY m.created_at, m.id`
      )
      .all(input.ownerId, input.agentInstanceId, new Date().toISOString())
      .map(toAgentMemory)
  }

  async propose(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
    readonly kind: AgentMemoryKind
    readonly content: Readonly<Record<string, unknown>>
    readonly expiresAt?: Date
  }): Promise<AgentMemoryRecord> {
    const instance = this.database
      .prepare(
        "SELECT 1 FROM agent_instances WHERE id = ? AND owner_id = ?"
      )
      .get(input.agentInstanceId, input.ownerId)
    if (!instance) {
      throw new Error("Agent instance not found")
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    const status = initialMemoryStatus(input.kind)
    this.database.exec("BEGIN IMMEDIATE")
    try {
      this.database
        .prepare(
          `INSERT INTO agent_memories
           (id, owner_id, agent_instance_id, kind, status, current_version,
            expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          id,
          input.ownerId,
          input.agentInstanceId,
          input.kind,
          status,
          input.expiresAt?.toISOString() ?? null,
          now,
          now
        )
      this.database
        .prepare(
          `INSERT INTO agent_memory_versions
           (memory_id, version, content_json, created_at)
           VALUES (?, 1, ?, ?)`
        )
        .run(id, JSON.stringify(input.content), now)
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
    return {
      id,
      ownerId: input.ownerId,
      agentInstanceId: input.agentInstanceId,
      kind: input.kind,
      status,
      version: 1,
      content: input.content,
      createdAt: new Date(now),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    }
  }

  async decide(input: {
    readonly ownerId: string
    readonly agentInstanceId: string
    readonly memoryId: string
    readonly decision: "approve" | "reject"
  }): Promise<AgentMemoryRecord | null> {
    const status = input.decision === "approve" ? "active" : "rejected"
    const result = this.database
      .prepare(
        `UPDATE agent_memories SET status = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND agent_instance_id = ?
           AND status = 'proposed'`
      )
      .run(
        status,
        new Date().toISOString(),
        input.memoryId,
        input.ownerId,
        input.agentInstanceId
      )
    if (result.changes === 0) return null
    const row = this.database
      .prepare(
        `SELECT m.*, v.content_json
         FROM agent_memories m
         JOIN agent_memory_versions v
           ON v.memory_id = m.id AND v.version = m.current_version
         WHERE m.id = ? AND m.owner_id = ? AND m.agent_instance_id = ?`
      )
      .get(input.memoryId, input.ownerId, input.agentInstanceId)
    return toAgentMemory(row)
  }

  async get(ownerId: string, runId: string): Promise<AgentRunRecord | null> {
    const row = this.database
      .prepare(
        `SELECT id, episode_job_id, owner_id, status, policy_hash, started_at
         FROM agent_runs WHERE id = ? AND owner_id = ?`
      )
      .get(runId, ownerId)
    return row ? toAgentRun(row) : null
  }

  async transition(input: {
    readonly ownerId: string
    readonly runId: string
    readonly expected: AgentRunStatus
    readonly next: AgentRunStatus
  }): Promise<boolean> {
    transitionAgentRun(input.expected, input.next)
    const terminal = ["succeeded", "failed", "canceled"].includes(input.next)
    const result = this.database
      .prepare(
        `UPDATE agent_runs SET status = ?, finished_at = ?
         WHERE id = ? AND owner_id = ? AND status = ?`
      )
      .run(
        input.next,
        terminal ? new Date().toISOString() : null,
        input.runId,
        input.ownerId,
        input.expected
      )
    return result.changes === 1
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO agent_events
         (id, agent_run_id, sequence, event_type, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        event.runId,
        event.sequence,
        event.type,
        JSON.stringify({ schemaVersion: event.schemaVersion, ...event.payload }),
        event.occurredAt.toISOString()
      )
  }
}

function toAgentInstance(row: unknown): AgentInstanceRecord {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    ownerId: String(value.owner_id),
    agentKey: String(value.agent_key),
    createdAt: new Date(String(value.created_at)),
  }
}

function toAgentMemory(row: unknown): AgentMemoryRecord {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    ownerId: String(value.owner_id),
    agentInstanceId: String(value.agent_instance_id),
    kind: String(value.kind) as AgentMemoryKind,
    status: String(value.status) as AgentMemoryStatus,
    version: Number(value.current_version),
    content: JSON.parse(String(value.content_json)) as Record<string, unknown>,
    createdAt: new Date(String(value.created_at)),
    ...(value.expires_at
      ? { expiresAt: new Date(String(value.expires_at)) }
      : {}),
  }
}

function toAgentRun(row: unknown): AgentRunRecord {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    jobId: String(value.episode_job_id),
    ownerId: String(value.owner_id),
    status: String(value.status) as AgentRunStatus,
    policyHash: String(value.policy_hash),
    createdAt: new Date(String(value.started_at)),
  }
}
