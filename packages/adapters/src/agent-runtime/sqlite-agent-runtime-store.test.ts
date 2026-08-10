import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStore } from "../db/local-store.js"
import { SqliteAgentRuntimeStore } from "./sqlite-agent-runtime-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("SqliteAgentRuntimeStore", () => {
  it("isolates durable memory by owner and agent instance", async () => {
    const { runtime, store } = createStores()
    const ownerAgent = await runtime.ensureInstance("owner-1", "podcast-editor")
    const otherAgent = await runtime.ensureInstance("owner-2", "podcast-editor")
    const preference = await runtime.propose({
      ownerId: "owner-1",
      agentInstanceId: ownerAgent.id,
      kind: "preference",
      content: { topics: ["AI", "Rust"] },
    })
    const history = await runtime.propose({
      ownerId: "owner-1",
      agentInstanceId: ownerAgent.id,
      kind: "episode_history",
      content: { episodeId: "episode-1" },
    })

    expect(preference.status).toBe("proposed")
    expect(history.status).toBe("active")
    await expect(
      runtime.decide({
        ownerId: "owner-2",
        agentInstanceId: otherAgent.id,
        memoryId: preference.id,
        decision: "approve",
      })
    ).resolves.toBeNull()
    await expect(
      runtime.decide({
        ownerId: "owner-1",
        agentInstanceId: ownerAgent.id,
        memoryId: preference.id,
        decision: "approve",
      })
    ).resolves.toMatchObject({ status: "active", version: 1 })
    await expect(
      runtime.listActive({
        ownerId: "owner-1",
        agentInstanceId: ownerAgent.id,
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: preference.id }),
        expect.objectContaining({ id: history.id }),
      ])
    )
    await expect(
      runtime.listActive({
        ownerId: "owner-2",
        agentInstanceId: otherAgent.id,
      })
    ).resolves.toEqual([])
    store.close()
  })

  it("rejects a memory for an instance outside the owner scope", async () => {
    const { runtime, store } = createStores()
    const instance = await runtime.ensureInstance("owner-1", "podcast-editor")

    await expect(
      runtime.propose({
        ownerId: "owner-2",
        agentInstanceId: instance.id,
        kind: "working_note",
        content: { note: "untrusted" },
      })
    ).rejects.toThrow("Agent instance not found")
    store.close()
  })

  it("persists run transitions and versioned events", async () => {
    const { runtime, store } = createStores()
    const job = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "run-test",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [],
    })
    const runId = store.startAgentRun({
      jobId: job.jobId,
      ownerId: "owner-1",
      model: "test-model",
    })

    await expect(runtime.get("owner-2", runId)).resolves.toBeNull()
    await expect(runtime.get("owner-1", runId)).resolves.toMatchObject({
      id: runId,
      jobId: job.jobId,
      status: "running",
      policyHash: "legacy",
    })
    await expect(
      runtime.transition({
        ownerId: "owner-1",
        runId,
        expected: "running",
        next: "retrying",
      })
    ).resolves.toBe(true)
    await expect(
      runtime.transition({
        ownerId: "owner-1",
        runId,
        expected: "running",
        next: "failed",
      })
    ).resolves.toBe(false)
    await runtime.appendEvent({
      schemaVersion: 1,
      runId,
      sequence: 0,
      type: "run.retrying",
      occurredAt: new Date("2026-08-10T00:00:00.000Z"),
      payload: { reason: "provider_timeout" },
    })
    expect(
      store.database
        .prepare(
          "SELECT event_type, payload_json FROM agent_events WHERE agent_run_id = ?"
        )
        .get(runId)
    ).toMatchObject({
      event_type: "run.retrying",
      payload_json: '{"schemaVersion":1,"reason":"provider_timeout"}',
    })
    store.close()
  })
})

function createStores() {
  const directory = mkdtempSync(join(tmpdir(), "agent-runtime-store-"))
  directories.push(directory)
  const store = new LocalStore(join(directory, "app.sqlite"))
  return {
    store,
    runtime: new SqliteAgentRuntimeStore(store.database),
  }
}
