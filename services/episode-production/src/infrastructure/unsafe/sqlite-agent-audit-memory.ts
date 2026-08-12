import { DatabaseSync } from "node:sqlite"

export type AgentInstanceRow = Readonly<{
  id: string
  ownerId: string
  agentKey: string
  createdAt: string
  updatedAt: string
}>
export type AgentRunRow = Readonly<{
  id: string
  jobId: string
  ownerId: string
  agentInstanceId: string | null
  model: string
  status: string
  policyHash: string
  createdAt: string
  finishedAt: string | null
  failureCode: string | null
}>
export type AgentEventRow = Readonly<{
  runId: string
  sequence: number
  eventType: string
  payloadJson: string
  occurredAt: string
}>
export type AgentMemoryRow = Readonly<{
  id: string
  ownerId: string
  agentInstanceId: string
  kind: string
  status: string
  currentVersion: number
  contentJson: string
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}>

export type UnsafeAgentAuditMemoryHandle = Readonly<{
  ensureInstance: (row: AgentInstanceRow) => AgentInstanceRow
  listInstances: (ownerId: string) => readonly AgentInstanceRow[]
  recordRun: (row: AgentRunRow) =>
    | { readonly _tag: "Created" }
    | { readonly _tag: "Existing"; readonly row: AgentRunRow }
    | { readonly _tag: "ScopeConflict" }
  findOwnedRun: (ownerId: string, runId: string) => AgentRunRow | undefined
  replayOwnedEvents: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly afterSequence: number
    readonly limit: number
  }) => readonly AgentEventRow[] | undefined
  appendOwnedEvent: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly eventType: string
    readonly payloadJson: string
    readonly occurredAt: string
  }) => AgentEventRow | undefined
  transitionOwnedRun: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly expected: string
    readonly next: string
    readonly finishedAt: string | null
    readonly failureCode: string | null
    readonly eventType: string
    readonly payloadJson: string
    readonly occurredAt: string
  }) =>
    | { readonly _tag: "Transitioned"; readonly run: AgentRunRow; readonly event: AgentEventRow }
    | { readonly _tag: "NotFound" }
    | { readonly _tag: "StateConflict"; readonly current: string }
  proposeMemory: (row: AgentMemoryRow) => boolean
  listOwnedMemories: (
    ownerId: string,
    instanceId: string
  ) => readonly AgentMemoryRow[] | undefined
  decideOwnedMemory: (input: {
    readonly ownerId: string
    readonly instanceId: string
    readonly memoryId: string
    readonly nextStatus: string
    readonly updatedAt: string
  }) =>
    | { readonly _tag: "Updated"; readonly row: AgentMemoryRow }
    | { readonly _tag: "NotFound" }
    | { readonly _tag: "StateConflict" }
  softDeleteOwnedMemory: (input: {
    readonly ownerId: string
    readonly instanceId: string
    readonly memoryId: string
    readonly updatedAt: string
  }) => "Deleted" | "NotFound" | "StateConflict"
  close: () => void
}>

const instanceSelect = `
SELECT id, owner_id AS ownerId, agent_key AS agentKey,
       created_at AS createdAt, updated_at AS updatedAt
FROM production_agent_instances`
const runSelect = `
SELECT id, job_id AS jobId, owner_id AS ownerId,
       agent_instance_id AS agentInstanceId, model, status,
       policy_hash AS policyHash, created_at AS createdAt,
       finished_at AS finishedAt, failure_code AS failureCode
FROM production_agent_runs`
const eventSelect = `
SELECT run_id AS runId, sequence, event_type AS eventType,
       payload_json AS payloadJson, occurred_at AS occurredAt
FROM production_agent_events`
const memorySelect = `
SELECT m.id, m.owner_id AS ownerId,
       m.agent_instance_id AS agentInstanceId, m.kind, m.status,
       m.current_version AS currentVersion, v.content_json AS contentJson,
       m.expires_at AS expiresAt, m.created_at AS createdAt,
       m.updated_at AS updatedAt
FROM production_agent_memories AS m
JOIN production_agent_memory_versions AS v
  ON v.memory_id = m.id AND v.version = m.current_version`

/** Mutable SQLite and transaction control are confined to this interop module. */
export const openUnsafeAgentAuditMemoryHandle = (
  databasePath: string
): UnsafeAgentAuditMemoryHandle => {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS production_agent_instances (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      agent_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_id, agent_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS production_agent_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES episode_jobs(job_id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      agent_instance_id TEXT REFERENCES production_agent_instances(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'queued', 'running', 'waiting_approval', 'retrying',
        'succeeded', 'failed', 'canceled'
      )),
      policy_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      failure_code TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS production_agent_runs_owner_status
      ON production_agent_runs(owner_id, status, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS production_agent_events (
      run_id TEXT NOT NULL REFERENCES production_agent_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      occurred_at TEXT NOT NULL,
      PRIMARY KEY(run_id, sequence)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS production_agent_memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      agent_instance_id TEXT NOT NULL REFERENCES production_agent_instances(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('preference', 'episode_history', 'working_note')),
      status TEXT NOT NULL CHECK(status IN ('proposed', 'active', 'rejected', 'deleted')),
      current_version INTEGER NOT NULL CHECK(current_version >= 1),
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS production_agent_memories_scope
      ON production_agent_memories(owner_id, agent_instance_id, status, kind, id);
    CREATE TABLE IF NOT EXISTS production_agent_memory_versions (
      memory_id TEXT NOT NULL REFERENCES production_agent_memories(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK(version >= 1),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(memory_id, version)
    ) STRICT;
  `)

  const transaction = <Value>(body: () => Value): Value => {
    database.exec("BEGIN IMMEDIATE")
    try {
      const value = body()
      database.exec("COMMIT")
      return value
    } catch (cause) {
      database.exec("ROLLBACK")
      throw cause
    }
  }

  const insertInstance = database.prepare(`
    INSERT INTO production_agent_instances(id, owner_id, agent_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, agent_key) DO UPDATE SET updated_at = excluded.updated_at
  `)
  const findInstanceByKey = database.prepare(
    `${instanceSelect} WHERE owner_id = ? AND agent_key = ?`
  )
  const listInstances = database.prepare(
    `${instanceSelect} WHERE owner_id = ? ORDER BY created_at, id`
  )
  const insertRun = database.prepare(`
    INSERT INTO production_agent_runs(
      id, job_id, owner_id, agent_instance_id, model, status,
      policy_hash, created_at, finished_at, failure_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `)
  const findRunById = database.prepare(`${runSelect} WHERE id = ?`)
  const findOwnedJob = database.prepare(
    "SELECT 1 FROM episode_jobs WHERE owner_id = ? AND job_id = ?"
  )
  const findOwnedRun = database.prepare(
    `${runSelect} WHERE owner_id = ? AND id = ?`
  )
  const listEvents = database.prepare(`
    ${eventSelect}
    WHERE run_id = ? AND sequence > ?
    ORDER BY sequence LIMIT ?
  `)
  const nextSequence = database.prepare(`
    SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence
    FROM production_agent_events WHERE run_id = ?
  `)
  const insertEvent = database.prepare(`
    INSERT INTO production_agent_events(
      run_id, sequence, event_type, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const updateRun = database.prepare(`
    UPDATE production_agent_runs
       SET status = ?, finished_at = ?, failure_code = ?
     WHERE owner_id = ? AND id = ? AND status = ?
  `)
  const insertMemory = database.prepare(`
    INSERT INTO production_agent_memories(
      id, owner_id, agent_instance_id, kind, status, current_version,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMemoryVersion = database.prepare(`
    INSERT INTO production_agent_memory_versions(memory_id, version, content_json, created_at)
    VALUES (?, ?, ?, ?)
  `)
  const findOwnedInstance = database.prepare(
    "SELECT 1 FROM production_agent_instances WHERE owner_id = ? AND id = ?"
  )
  const listMemories = database.prepare(`
    ${memorySelect}
    WHERE m.owner_id = ? AND m.agent_instance_id = ? AND m.status != 'deleted'
    ORDER BY m.created_at, m.id
  `)
  const findOwnedMemory = database.prepare(`
    ${memorySelect}
    WHERE m.owner_id = ? AND m.agent_instance_id = ? AND m.id = ?
  `)
  const updateMemoryStatus = database.prepare(`
    UPDATE production_agent_memories SET status = ?, updated_at = ?
    WHERE owner_id = ? AND agent_instance_id = ? AND id = ? AND status = ?
  `)

  const insertNextEvent = (input: {
    readonly runId: string
    readonly eventType: string
    readonly payloadJson: string
    readonly occurredAt: string
  }): AgentEventRow => {
    const sequence = Number(
      (nextSequence.get(input.runId) as { readonly sequence: number }).sequence
    )
    insertEvent.run(
      input.runId,
      sequence,
      input.eventType,
      input.payloadJson,
      input.occurredAt
    )
    return {
      runId: input.runId,
      sequence,
      eventType: input.eventType,
      payloadJson: input.payloadJson,
      occurredAt: input.occurredAt,
    }
  }

  return {
    ensureInstance: (row) =>
      transaction(() => {
        insertInstance.run(
          row.id,
          row.ownerId,
          row.agentKey,
          row.createdAt,
          row.updatedAt
        )
        return findInstanceByKey.get(row.ownerId, row.agentKey) as AgentInstanceRow
      }),
    listInstances: (ownerId) =>
      listInstances.all(ownerId) as unknown as readonly AgentInstanceRow[],
    recordRun: (row) =>
      transaction(() => {
        if (findOwnedJob.get(row.ownerId, row.jobId) === undefined) {
          return { _tag: "ScopeConflict" as const }
        }
        if (
          row.agentInstanceId !== null &&
          findOwnedInstance.get(row.ownerId, row.agentInstanceId) === undefined
        ) {
          return { _tag: "ScopeConflict" as const }
        }
        const result = insertRun.run(
          row.id,
          row.jobId,
          row.ownerId,
          row.agentInstanceId,
          row.model,
          row.status,
          row.policyHash,
          row.createdAt,
          row.finishedAt,
          row.failureCode
        )
        return result.changes === 1
          ? { _tag: "Created" as const }
          : {
              _tag: "Existing" as const,
              row: findRunById.get(row.id) as AgentRunRow,
            }
      }),
    findOwnedRun: (ownerId, runId) =>
      findOwnedRun.get(ownerId, runId) as AgentRunRow | undefined,
    replayOwnedEvents: (input) => {
      if (findOwnedRun.get(input.ownerId, input.runId) === undefined) {
        return undefined
      }
      return listEvents.all(
        input.runId,
        input.afterSequence,
        input.limit
      ) as unknown as readonly AgentEventRow[]
    },
    appendOwnedEvent: (input) =>
      transaction(() => {
        if (findOwnedRun.get(input.ownerId, input.runId) === undefined) {
          return undefined
        }
        return insertNextEvent(input)
      }),
    transitionOwnedRun: (input) =>
      transaction(() => {
        const current = findOwnedRun.get(input.ownerId, input.runId) as
          | AgentRunRow
          | undefined
        if (current === undefined) return { _tag: "NotFound" as const }
        if (current.status !== input.expected) {
          return { _tag: "StateConflict" as const, current: current.status }
        }
        const updated = updateRun.run(
          input.next,
          input.finishedAt,
          input.failureCode,
          input.ownerId,
          input.runId,
          input.expected
        )
        if (updated.changes !== 1) {
          throw new Error("agent run changed during transaction")
        }
        const event = insertNextEvent({
          runId: input.runId,
          eventType: input.eventType,
          payloadJson: input.payloadJson,
          occurredAt: input.occurredAt,
        })
        return {
          _tag: "Transitioned" as const,
          run: findOwnedRun.get(input.ownerId, input.runId) as AgentRunRow,
          event,
        }
      }),
    proposeMemory: (row) =>
      transaction(() => {
        if (findOwnedInstance.get(row.ownerId, row.agentInstanceId) === undefined) {
          return false
        }
        insertMemory.run(
          row.id,
          row.ownerId,
          row.agentInstanceId,
          row.kind,
          row.status,
          row.currentVersion,
          row.expiresAt,
          row.createdAt,
          row.updatedAt
        )
        insertMemoryVersion.run(
          row.id,
          row.currentVersion,
          row.contentJson,
          row.createdAt
        )
        return true
      }),
    listOwnedMemories: (ownerId, instanceId) =>
      findOwnedInstance.get(ownerId, instanceId) === undefined
        ? undefined
        : (listMemories.all(ownerId, instanceId) as unknown as readonly AgentMemoryRow[]),
    decideOwnedMemory: (input) =>
      transaction(() => {
        const current = findOwnedMemory.get(
          input.ownerId,
          input.instanceId,
          input.memoryId
        ) as AgentMemoryRow | undefined
        if (current === undefined) return { _tag: "NotFound" as const }
        if (current.status !== "proposed") {
          return { _tag: "StateConflict" as const }
        }
        updateMemoryStatus.run(
          input.nextStatus,
          input.updatedAt,
          input.ownerId,
          input.instanceId,
          input.memoryId,
          "proposed"
        )
        return {
          _tag: "Updated" as const,
          row: findOwnedMemory.get(
            input.ownerId,
            input.instanceId,
            input.memoryId
          ) as AgentMemoryRow,
        }
      }),
    softDeleteOwnedMemory: (input) =>
      transaction(() => {
        const current = findOwnedMemory.get(
          input.ownerId,
          input.instanceId,
          input.memoryId
        ) as AgentMemoryRow | undefined
        if (current === undefined) return "NotFound" as const
        if (current.status === "deleted") return "StateConflict" as const
        const result = updateMemoryStatus.run(
          "deleted",
          input.updatedAt,
          input.ownerId,
          input.instanceId,
          input.memoryId,
          current.status
        )
        return result.changes === 1
          ? ("Deleted" as const)
          : ("StateConflict" as const)
      }),
    close: () => database.close(),
  }
}
