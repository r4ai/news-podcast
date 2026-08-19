import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { runArchiveCleanupCycle } from "./archive-cleanup.js"

describe("archive orphan cleanup", () => {
  it("passes database references and the retention cutoff to one bounded sweep", async () => {
    const listReferencedSnapshotIds = vi.fn(() =>
      Effect.succeed(["46c2eef5-a205-4526-8640-dc3ea84d88b4" as never] as const)
    )
    const cleanupOrphans = vi.fn(() =>
      Effect.succeed({
        trigger: "retention_sweep" as const,
        attempted: 2,
        deleted: 2,
        failed: 0,
      })
    )

    const outcome = await Effect.runPromise(
      runArchiveCleanupCycle(
        { retentionMillis: 24 * 60 * 60 * 1_000 },
        { listReferencedSnapshotIds, cleanupOrphans },
        () => new Date("2026-08-19T12:00:00.000Z")
      )
    )

    expect(outcome.deleted).toBe(2)
    expect(cleanupOrphans).toHaveBeenCalledWith({
      referencedSnapshotIds: new Set(["46c2eef5-a205-4526-8640-dc3ea84d88b4"]),
      olderThan: new Date("2026-08-18T12:00:00.000Z"),
    })
  })
})
