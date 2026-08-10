import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SqliteAgentRuntimeStore } from "@news-podcast/adapters/agent-runtime/sqlite"
import { LocalStore } from "@news-podcast/adapters/db/local"

import { createApp } from "./app.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("agent runtime API", () => {
  it("supports the owner-scoped Memory proposal lifecycle", async () => {
    const { app, runtime, store } = await createRuntimeApp("owner-1")
    const instance = await runtime.ensureInstance("owner-1", "podcast-editor")

    const proposedResponse = await app.request(
      `/v1/agent-instances/${instance.id}/memories`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "preference",
          content: { preferredTopics: ["AI", "Rust"] },
        }),
      }
    )
    expect(proposedResponse.status).toBe(201)
    const proposed = (await proposedResponse.json()) as {
      id: string
      status: string
    }
    expect(proposed.status).toBe("proposed")

    const approvedResponse = await app.request(
      `/v1/agent-instances/${instance.id}/memories/${proposed.id}/approve`,
      { method: "POST" }
    )
    expect(approvedResponse.status).toBe(200)
    await expect(approvedResponse.json()).resolves.toMatchObject({
      status: "active",
    })

    const listResponse = await app.request(
      `/v1/agent-instances/${instance.id}/memories`
    )
    await expect(listResponse.json()).resolves.toMatchObject({
      items: [{ id: proposed.id, status: "active" }],
    })

    const deletedResponse = await app.request(
      `/v1/agent-instances/${instance.id}/memories/${proposed.id}`,
      { method: "DELETE" }
    )
    expect(deletedResponse.status).toBe(204)
    store.close()
  })

  it("does not resolve Memory through another owner or Agent instance", async () => {
    const { runtime, store } = await createRuntimeApp("owner-1")
    const ownerAgent = await runtime.ensureInstance("owner-1", "podcast-editor")
    const otherAgent = await runtime.ensureInstance("owner-1", "researcher")
    const memory = await runtime.propose({
      ownerId: "owner-1",
      agentInstanceId: ownerAgent.id,
      kind: "working_note",
      content: { note: "scoped" },
    })
    const wrongAgentApp = createApp({
      store,
      agentRuntimeStore: runtime,
      resolveOwner: async () => "owner-1",
    })
    const response = await wrongAgentApp.request(
      `/v1/agent-instances/${otherAgent.id}/memories/${memory.id}/approve`,
      { method: "POST" }
    )
    expect(response.status).toBe(404)
    store.close()
  })
})

async function createRuntimeApp(ownerId: string) {
  const directory = mkdtempSync(join(tmpdir(), "api-agent-runtime-"))
  directories.push(directory)
  const store = new LocalStore(join(directory, "app.sqlite"))
  const runtime = new SqliteAgentRuntimeStore(store.database)
  return {
    store,
    runtime,
    app: createApp({
      store,
      agentRuntimeStore: runtime,
      resolveOwner: async () => ownerId,
    }),
  }
}
