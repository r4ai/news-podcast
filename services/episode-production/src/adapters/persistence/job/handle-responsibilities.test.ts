import { describe, expect, it, vi } from "vitest"

import { openProductionDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeJobHandle } from "./handle.js"
import { makeJobOutboxHandle } from "./outbox-handle.js"
import { makeJobPlanHandle } from "./plan-handle.js"
import { makeJobProgressHandle } from "./progress-handle.js"
import { makeJobReadHandle } from "./read-handle.js"

const expectedMethods = {
  read: [
    "findById",
    "findOwned",
    "listOwned",
    "listOwnedAgUiEvents",
    "ownerActiveSnapshot",
    "statusSnapshot",
  ],
  progress: [
    "hasLease",
    "leaseNext",
    "markStep",
    "recordSelectedArticles",
    "renewLease",
    "replaceOwnedActive",
    "reportStageProgress",
    "requeueRecoverableScheduled",
    "saveIdempotently",
    "transition",
  ],
  plan: [
    "listUsedAutomaticArticleIds",
    "loadCheckpoint",
    "loadDictionarySnapshot",
    "loadGenerationPlan",
    "saveAudioCheckpoint",
    "saveDictionarySnapshot",
    "saveGenerationPlan",
    "saveScriptCheckpoint",
  ],
  outbox: [
    "completeWithOutbox",
    "findCompletionOutbox",
    "listPendingCompletionOutbox",
    "markCompletionPublished",
  ],
} as const

describe("SQLite job handle responsibilities", () => {
  it("composes disjoint use-case handles without changing the public contract", () => {
    const database = openProductionDatabaseUnsafe(":memory:")
    try {
      const handles = {
        read: makeJobReadHandle(database.database),
        progress: makeJobProgressHandle(database.database),
        plan: makeJobPlanHandle(database.database),
        outbox: makeJobOutboxHandle(database.database),
      }

      for (const [responsibility, handle] of Object.entries(handles)) {
        expect(Object.keys(handle).sort()).toEqual(
          [...expectedMethods[responsibility as keyof typeof handles]].sort()
        )
      }

      const componentMethods = Object.values(handles).flatMap(Object.keys)
      expect(new Set(componentMethods).size).toBe(componentMethods.length)
      expect(Object.keys(makeJobHandle(database.database)).sort()).toEqual(
        [...componentMethods, "close"].sort()
      )
    } finally {
      database.close()
    }
  })

  it("keeps reads outside transactions and each write responsibility inside one", () => {
    const database = openProductionDatabaseUnsafe(":memory:")
    const transaction = vi.spyOn(database.database, "transaction")
    const jobId = "10e2d4e1-c127-479f-a124-2ea037bd9319"
    const leaseToken = "lease-1"

    try {
      makeJobReadHandle(database.database).findById(jobId)
      expect(transaction).not.toHaveBeenCalled()

      expect(
        makeJobProgressHandle(database.database).markStep({
          jobId,
          leaseToken,
          step: "selecting_articles",
          phase: "started",
          occurredAt: "2026-08-20T00:00:00.000Z",
        })
      ).toBe(false)
      expect(transaction).toHaveBeenCalledTimes(1)

      expect(
        makeJobPlanHandle(database.database).saveGenerationPlan({
          jobId,
          leaseToken,
          plan: "{}",
        })
      ).toEqual({ _tag: "StaleLease" })
      expect(transaction).toHaveBeenCalledTimes(2)

      expect(
        makeJobOutboxHandle(database.database).completeWithOutbox({
          jobId,
          leaseToken,
          document: "{}",
          episodeId: "episode-1",
          payload: "{}",
          createdAt: "2026-08-20T00:00:00.000Z",
        })
      ).toBe("StaleLease")
      expect(transaction).toHaveBeenCalledTimes(3)
    } finally {
      database.close()
    }
  })
})
