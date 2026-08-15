import { and, asc, eq, gt, ne, sql } from "drizzle-orm"

import {
  episodeJobs,
  productionAgentEvents,
  productionAgentInstances,
  productionAgentMemories,
  productionAgentMemoryVersions,
  productionAgentRuns,
} from "../../../../drizzle/schema.js"
import type {
  ProductionDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import type {
  AgentEventRow,
  AgentInstanceRow,
  AgentMemoryRow,
  AgentRunRow,
  UnsafeAgentAuditMemoryHandle,
} from "./ports.js"

const instanceProjection = {
  id: productionAgentInstances.id,
  ownerId: productionAgentInstances.ownerId,
  agentKey: productionAgentInstances.agentKey,
  createdAt: productionAgentInstances.createdAt,
  updatedAt: productionAgentInstances.updatedAt,
}

const runProjection = {
  id: productionAgentRuns.id,
  jobId: productionAgentRuns.jobId,
  ownerId: productionAgentRuns.ownerId,
  agentInstanceId: productionAgentRuns.agentInstanceId,
  model: productionAgentRuns.model,
  status: productionAgentRuns.status,
  policyHash: productionAgentRuns.policyHash,
  createdAt: productionAgentRuns.createdAt,
  finishedAt: productionAgentRuns.finishedAt,
  failureCode: productionAgentRuns.failureCode,
}

const eventProjection = {
  runId: productionAgentEvents.runId,
  sequence: productionAgentEvents.sequence,
  eventType: productionAgentEvents.eventType,
  payloadJson: productionAgentEvents.payloadJson,
  occurredAt: productionAgentEvents.occurredAt,
}

const memoryProjection = {
  id: productionAgentMemories.id,
  ownerId: productionAgentMemories.ownerId,
  agentInstanceId: productionAgentMemories.agentInstanceId,
  kind: productionAgentMemories.kind,
  status: productionAgentMemories.status,
  currentVersion: productionAgentMemories.currentVersion,
  contentJson: productionAgentMemoryVersions.contentJson,
  expiresAt: productionAgentMemories.expiresAt,
  createdAt: productionAgentMemories.createdAt,
  updatedAt: productionAgentMemories.updatedAt,
}

/** 記憶は常に「現在の版」の内容と一緒にしか読まれない。 */
const selectMemories = (runner: QueryRunner) =>
  runner
    .select(memoryProjection)
    .from(productionAgentMemories)
    .innerJoin(
      productionAgentMemoryVersions,
      and(
        eq(productionAgentMemoryVersions.memoryId, productionAgentMemories.id),
        eq(
          productionAgentMemoryVersions.version,
          productionAgentMemories.currentVersion
        )
      )
    )

const findOwnedRunRow = (
  runner: QueryRunner,
  ownerId: string,
  runId: string
): AgentRunRow | undefined =>
  runner
    .select(runProjection)
    .from(productionAgentRuns)
    .where(
      and(
        eq(productionAgentRuns.ownerId, ownerId),
        eq(productionAgentRuns.id, runId)
      )
    )
    .get() as AgentRunRow | undefined

export const makeAgentAuditMemoryHandle = (
  database: ProductionDatabase
): UnsafeAgentAuditMemoryHandle => {
  /** 追記は常に既存の最大連番の次へ。番号の欠落も重複も作らない。 */
  const insertNextEvent = (
    runner: QueryRunner,
    input: {
      readonly runId: string
      readonly eventType: string
      readonly payloadJson: string
      readonly occurredAt: string
    }
  ): AgentEventRow => {
    const next = runner
      .select({
        sequence:
          sql<number>`COALESCE(MAX(${productionAgentEvents.sequence}), -1) + 1`.as(
            "sequence"
          ),
      })
      .from(productionAgentEvents)
      .where(eq(productionAgentEvents.runId, input.runId))
      .get()
    const sequence = Number(next?.sequence ?? 0)

    runner
      .insert(productionAgentEvents)
      .values({
        runId: input.runId,
        sequence,
        eventType: input.eventType,
        payloadJson: input.payloadJson,
        occurredAt: input.occurredAt,
      })
      .run()

    return {
      runId: input.runId,
      sequence,
      eventType: input.eventType,
      payloadJson: input.payloadJson,
      occurredAt: input.occurredAt,
    }
  }

  const ownsJob = (runner: QueryRunner, ownerId: string, jobId: string) =>
    runner
      .select({ jobId: episodeJobs.jobId })
      .from(episodeJobs)
      .where(
        and(eq(episodeJobs.ownerId, ownerId), eq(episodeJobs.jobId, jobId))
      )
      .get() !== undefined

  const ownsInstance = (
    runner: QueryRunner,
    ownerId: string,
    instanceId: string
  ) =>
    runner
      .select({ id: productionAgentInstances.id })
      .from(productionAgentInstances)
      .where(
        and(
          eq(productionAgentInstances.ownerId, ownerId),
          eq(productionAgentInstances.id, instanceId)
        )
      )
      .get() !== undefined

  return {
    ensureInstance: (row) =>
      database.transaction((tx) => {
        tx.insert(productionAgentInstances)
          .values(row)
          .onConflictDoUpdate({
            target: [
              productionAgentInstances.ownerId,
              productionAgentInstances.agentKey,
            ],
            set: { updatedAt: row.updatedAt },
          })
          .run()

        return tx
          .select(instanceProjection)
          .from(productionAgentInstances)
          .where(
            and(
              eq(productionAgentInstances.ownerId, row.ownerId),
              eq(productionAgentInstances.agentKey, row.agentKey)
            )
          )
          .get() as AgentInstanceRow
      }),

    listInstances: (ownerId) =>
      database
        .select(instanceProjection)
        .from(productionAgentInstances)
        .where(eq(productionAgentInstances.ownerId, ownerId))
        .orderBy(
          asc(productionAgentInstances.createdAt),
          asc(productionAgentInstances.id)
        )
        .all(),

    recordRun: (row) =>
      database.transaction((tx) => {
        // 他人のジョブや他人のエージェントに実行記録を紐づけさせない。
        if (!ownsJob(tx, row.ownerId, row.jobId)) {
          return { _tag: "ScopeConflict" as const }
        }
        if (
          row.agentInstanceId !== null &&
          !ownsInstance(tx, row.ownerId, row.agentInstanceId)
        ) {
          return { _tag: "ScopeConflict" as const }
        }

        const inserted = tx
          .insert(productionAgentRuns)
          .values(row as never)
          .onConflictDoNothing({ target: productionAgentRuns.id })
          .run()

        if (Number(inserted.changes) === 1) return { _tag: "Created" as const }

        return {
          _tag: "Existing" as const,
          row: tx
            .select(runProjection)
            .from(productionAgentRuns)
            .where(eq(productionAgentRuns.id, row.id))
            .get() as AgentRunRow,
        }
      }),

    findOwnedRun: (ownerId, runId) => findOwnedRunRow(database, ownerId, runId),

    replayOwnedEvents: (input) => {
      if (findOwnedRunRow(database, input.ownerId, input.runId) === undefined) {
        return undefined
      }
      return database
        .select(eventProjection)
        .from(productionAgentEvents)
        .where(
          and(
            eq(productionAgentEvents.runId, input.runId),
            gt(productionAgentEvents.sequence, input.afterSequence)
          )
        )
        .orderBy(asc(productionAgentEvents.sequence))
        .limit(input.limit)
        .all()
    },

    appendOwnedEvent: (input) =>
      database.transaction((tx) => {
        if (findOwnedRunRow(tx, input.ownerId, input.runId) === undefined) {
          return undefined
        }
        return insertNextEvent(tx, input)
      }),

    transitionOwnedRun: (input) =>
      database.transaction((tx) => {
        const current = findOwnedRunRow(tx, input.ownerId, input.runId)
        if (current === undefined) return { _tag: "NotFound" as const }
        if (current.status !== input.expected) {
          return { _tag: "StateConflict" as const, current: current.status }
        }

        // 期待状態を条件に残し、競合した遷移を弾く。
        const updated = tx
          .update(productionAgentRuns)
          .set({
            status: input.next as never,
            finishedAt: input.finishedAt,
            failureCode: input.failureCode,
          })
          .where(
            and(
              eq(productionAgentRuns.ownerId, input.ownerId),
              eq(productionAgentRuns.id, input.runId),
              eq(productionAgentRuns.status, input.expected as never)
            )
          )
          .run()

        if (Number(updated.changes) !== 1) {
          return { _tag: "StateConflict" as const, current: current.status }
        }

        return {
          _tag: "Transitioned" as const,
          run: findOwnedRunRow(tx, input.ownerId, input.runId) as AgentRunRow,
          event: insertNextEvent(tx, input),
        }
      }),

    proposeMemory: (row) =>
      database.transaction((tx) => {
        if (!ownsInstance(tx, row.ownerId, row.agentInstanceId)) return false

        tx.insert(productionAgentMemories)
          .values({
            id: row.id,
            ownerId: row.ownerId,
            agentInstanceId: row.agentInstanceId,
            kind: row.kind as never,
            status: row.status as never,
            currentVersion: row.currentVersion,
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })
          .run()

        tx.insert(productionAgentMemoryVersions)
          .values({
            memoryId: row.id,
            version: row.currentVersion,
            contentJson: row.contentJson,
            createdAt: row.createdAt,
          })
          .run()

        return true
      }),

    listOwnedMemories: (ownerId, instanceId) => {
      if (!ownsInstance(database, ownerId, instanceId)) return undefined
      return selectMemories(database)
        .where(
          and(
            eq(productionAgentMemories.ownerId, ownerId),
            eq(productionAgentMemories.agentInstanceId, instanceId),
            ne(productionAgentMemories.status, "deleted")
          )
        )
        .orderBy(
          asc(productionAgentMemories.createdAt),
          asc(productionAgentMemories.id)
        )
        .all() as readonly AgentMemoryRow[]
    },

    decideOwnedMemory: (input) =>
      database.transaction((tx) => {
        const current = selectMemories(tx)
          .where(
            and(
              eq(productionAgentMemories.ownerId, input.ownerId),
              eq(productionAgentMemories.agentInstanceId, input.instanceId),
              eq(productionAgentMemories.id, input.memoryId)
            )
          )
          .get() as AgentMemoryRow | undefined
        if (current === undefined) return { _tag: "NotFound" as const }

        // 決着がつくのは提案中のものだけ。
        const updated = tx
          .update(productionAgentMemories)
          .set({
            status: input.nextStatus as never,
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(productionAgentMemories.ownerId, input.ownerId),
              eq(productionAgentMemories.agentInstanceId, input.instanceId),
              eq(productionAgentMemories.id, input.memoryId),
              eq(productionAgentMemories.status, "proposed")
            )
          )
          .run()
        if (Number(updated.changes) !== 1) {
          return { _tag: "StateConflict" as const }
        }

        return {
          _tag: "Updated" as const,
          row: selectMemories(tx)
            .where(
              and(
                eq(productionAgentMemories.ownerId, input.ownerId),
                eq(productionAgentMemories.agentInstanceId, input.instanceId),
                eq(productionAgentMemories.id, input.memoryId)
              )
            )
            .get() as AgentMemoryRow,
        }
      }),

    softDeleteOwnedMemory: (input) =>
      database.transaction((tx) => {
        const current = selectMemories(tx)
          .where(
            and(
              eq(productionAgentMemories.ownerId, input.ownerId),
              eq(productionAgentMemories.agentInstanceId, input.instanceId),
              eq(productionAgentMemories.id, input.memoryId)
            )
          )
          .get() as AgentMemoryRow | undefined
        if (current === undefined) return "NotFound" as const
        if (current.status === "deleted") return "StateConflict" as const

        tx.update(productionAgentMemories)
          .set({ status: "deleted", updatedAt: input.updatedAt })
          .where(
            and(
              eq(productionAgentMemories.ownerId, input.ownerId),
              eq(productionAgentMemories.agentInstanceId, input.instanceId),
              eq(productionAgentMemories.id, input.memoryId)
            )
          )
          .run()
        return "Deleted" as const
      }),

    close: () => {
      // 接続はサービスプロセスが所有する。
    },
  }
}
