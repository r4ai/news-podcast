import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStore } from "@news-podcast/adapters/db/local"
import type { AgUiEvent } from "@news-podcast/contracts/agui"

import { createApp } from "./app.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("episode job event stream", () => {
  it("opens with a snapshot and replays the run in order", async () => {
    const store = createStore()
    const jobId = await seedFinishedJob(store)
    const app = createApp({ store, resolveOwner: async () => "owner-1" })

    const response = await app.request(`/v1/episode-jobs/${jobId}/events`)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")

    const frames = parseSse(await response.text())
    expect(frames[0]?.event.type).toBe("STATE_SNAPSHOT")
    expect(frames[0]?.id).toBeUndefined()

    const types = frames.map((frame) => frame.event.type)
    expect(types).toContain("RUN_STARTED")
    expect(types).toContain("STEP_STARTED")
    expect(types).toContain("TOOL_CALL_START")
    expect(types).toContain("TOOL_CALL_RESULT")
    expect(types).toContain("STATE_DELTA")
    expect(types.at(-1)).toBe("RUN_FINISHED")

    // id は Last-Event-ID として使うので単調増加でなければならない。
    const ids = frames
      .map((frame) => frame.id)
      .filter((id): id is number => id !== undefined)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))

    store.close()
  })

  it("resumes from Last-Event-ID without a snapshot or duplicates", async () => {
    const store = createStore()
    const jobId = await seedFinishedJob(store)
    const app = createApp({ store, resolveOwner: async () => "owner-1" })

    const all = parseSse(
      await (await app.request(`/v1/episode-jobs/${jobId}/events`)).text()
    )
    const resumeAt = all.find(
      (frame) => frame.event.type === "TOOL_CALL_START"
    )!.id!

    const resumed = parseSse(
      await (
        await app.request(`/v1/episode-jobs/${jobId}/events`, {
          headers: { "Last-Event-ID": String(resumeAt) },
        })
      ).text()
    )

    expect(resumed.some((frame) => frame.event.type === "STATE_SNAPSHOT")).toBe(
      false
    )
    expect(resumed.every((frame) => (frame.id ?? 0) > resumeAt)).toBe(true)

    // 再開分と、再開点までの分を足すと元のストリームと過不足なく一致する。
    const beforeResume = all.filter((frame) => (frame.id ?? 0) <= resumeAt)
    expect(beforeResume.length + resumed.length).toBe(all.length)

    store.close()
  })

  it("hides another owner's job", async () => {
    const store = createStore()
    const jobId = await seedFinishedJob(store)
    const app = createApp({ store, resolveOwner: async () => "owner-2" })

    const response = await app.request(`/v1/episode-jobs/${jobId}/events`)
    expect(response.status).toBe(404)
    store.close()
  })
})

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "api-job-events-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

/** リースから完了までを一通り実行し、終端済みのイベント列を作る。 */
async function seedFinishedJob(store: LocalStore): Promise<string> {
  const created = await store.create({
    ownerId: "owner-1",
    idempotencyKey: "seed",
    requestHash: "hash",
    trigger: "manual",
    feedIds: ["00000000-0000-4000-8000-000000000001"],
  })
  const leased = store.leaseNext()!
  store.setJobStage(created.jobId, leased.leaseToken, "researching_sources")
  store.appendJobEvent({
    jobId: created.jobId,
    eventType: "stage.started",
    stage: "researching_sources",
  })
  store.appendJobEvent({
    jobId: created.jobId,
    eventType: "agent.tool_call",
    stage: "researching_sources",
    payload: {
      position: 0,
      name: "read_article",
      arguments: '{"article_id":"a"}',
      outputSummary: { title: "記事" },
    },
  })
  store.appendJobEvent({
    jobId: created.jobId,
    eventType: "agent.article_adopted",
    stage: "researching_sources",
    payload: {
      articleId: "a",
      title: "記事",
      url: "https://example.com/a",
      sourceName: "テスト",
    },
  })
  store.completeJob({
    jobId: created.jobId,
    episodeId: "00000000-0000-4000-8000-0000000000ff",
    ownerId: "owner-1",
    leaseToken: leased.leaseToken,
    title: "エピソード",
    script: "本文",
    audioKey: "audio/key.wav",
    audioByteLength: 44,
    sources: [],
  })
  return created.jobId
}

function parseSse(body: string): readonly { id?: number; event: AgUiEvent }[] {
  return body
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0 && !frame.startsWith(":"))
    .map((frame) => {
      const lines = frame.split("\n")
      const idLine = lines.find((line) => line.startsWith("id: "))
      const dataLine = lines.find((line) => line.startsWith("data: "))!
      return {
        ...(idLine ? { id: Number(idLine.slice(4)) } : {}),
        event: JSON.parse(dataLine.slice(6)) as AgUiEvent,
      }
    })
}
