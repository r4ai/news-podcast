import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LocalStore } from "@news-podcast/adapters/db/local"
import { CreateEpisodeJob } from "@news-podcast/application"
import { afterEach, describe, expect, it } from "vitest"

import { createFakeProcessor } from "./process-episode-job.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("local generation flow", () => {
  it("migrates SQLite and completes a contract-compliant fake episode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "news-podcast-"))
    temporaryDirectories.push(directory)
    const store = new LocalStore(join(directory, "app.sqlite"))
    const ownerId = "00000000-0000-4000-8000-000000000100"
    store.ensureDefaultSubscriptions(ownerId)

    const useCase = new CreateEpisodeJob(store, store, {
      dispatch: () => Promise.resolve(),
    })
    const record = await useCase.execute({
      ownerId,
      idempotencyKey: "fake-e2e",
      trigger: "manual",
    })
    const leased = store.leaseNext()
    expect(leased?.id).toBe(record.jobId)

    await createFakeProcessor(store, join(directory, "audio")).process(leased!)

    expect(store.getJob(ownerId, record.jobId)).toMatchObject({
      status: "succeeded",
      attempt: 1,
    })
    const [episode] = store.listEpisodes(ownerId)
    expect(episode?.sources).toEqual([
      expect.objectContaining({ url: "https://example.com/local-news" }),
    ])
    expect(store.getAudio(ownerId, episode!.id)?.size).toBeGreaterThan(44)
    store.close()
  })
})
