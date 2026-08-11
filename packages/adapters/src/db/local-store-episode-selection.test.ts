import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "store-episode-selection-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

/** 0001_foundation.sql が投入する既定フィード（Zenn）。 */
const FEED_ID = "00000000-0000-4000-8000-000000000001"

/** `episode_job_articles` は `feed_items` を外部キー参照するので実物が要る。 */
function seedArticles(
  store: LocalStore,
  externalIds: readonly string[]
): readonly string[] {
  store.upsertFeedItems(
    FEED_ID,
    externalIds.map((externalId) => ({
      externalId,
      title: `記事 ${externalId}`,
      url: `https://zenn.dev/${externalId}`,
    }))
  )
  const byExternalId = new Map(
    store
      .listArticles("owner-1", { limit: 50 })
      .items.map((article) => [article.url, article.id])
  )
  return externalIds.map((externalId) =>
    byExternalId.get(`https://zenn.dev/${externalId}`)!
  )
}

describe("episode article selection", () => {
  it("freezes the selection in order and carries it into a retry", async () => {
    const store = createStore()
    store.ensureDefaultSubscriptions("owner-1")
    const [a, b] = seedArticles(store, ["a", "b"])
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "with-selection",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [FEED_ID],
      articleIds: [b!, a!],
    })

    // 選択順がそのまま保持される（新着順に並べ替えない）。
    expect(store.listJobArticleIds(created.jobId)).toEqual([b, a])

    const leased = store.leaseNext()!
    store.failJob(created.jobId, leased.leaseToken, {
      code: "provider-timeout",
      message: "timeout",
      retryable: true,
    })
    const retried = store.retryFailedJob("owner-1", created.jobId)!

    expect(store.listJobArticleIds(retried.id)).toEqual([b, a])
    store.close()
  })

  it("stores no selection for a fully automatic job", async () => {
    const store = createStore()
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "auto",
      requestHash: "hash",
      trigger: "scheduled",
      feedIds: [FEED_ID],
    })

    expect(store.listJobArticleIds(created.jobId)).toEqual([])
    store.close()
  })

  it("rejects articles the owner cannot generate from", () => {
    const store = createStore()
    store.ensureDefaultSubscriptions("owner-1")

    // 実在しない記事も、アーカイブ未完了の記事も候補に残らない。
    expect(
      store.filterSelectableArticleIds("owner-1", ["missing-1", "missing-2"])
    ).toEqual([])
    expect(store.filterSelectableArticleIds("owner-1", [])).toEqual([])
    store.close()
  })

  it("keeps selected articles available after their feed is disabled", async () => {
    const store = createStore()
    store.ensureDefaultSubscriptions("owner-1")
    const [articleId] = seedArticles(store, ["disabled-feed"])
    const article = store.listArticles("owner-1", { limit: 1 }).items[0]!
    store.completeArchive({
      articleId: article.id,
      snapshotId: "00000000-0000-4000-8000-000000000021",
      sourceUrl: article.url,
      title: article.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 10,
      assets: [],
    })
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "disabled-feed-selection",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [FEED_ID],
      articleIds: [articleId!],
    })
    const subscription = store
      .listSubscriptions("owner-1")
      .find((item) => item.feedId === FEED_ID)!

    store.setSubscriptionEnabled("owner-1", subscription.id, false)

    expect(
      store
        .listAgentArticles("owner-1", [FEED_ID], 50, [articleId!])
        .map((article) => article.id)
    ).toEqual([articleId])
    expect(store.listJobArticleIds(created.jobId)).toEqual([articleId])
    store.close()
  })
})

describe("job event sequence", () => {
  it("numbers events per job starting at one", async () => {
    const store = createStore()
    const first = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "job-a",
      requestHash: "hash-a",
      trigger: "manual",
      feedIds: [FEED_ID],
    })
    const second = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "job-b",
      requestHash: "hash-b",
      trigger: "manual",
      feedIds: [FEED_ID],
    })

    store.appendJobEvent({ jobId: first.jobId, eventType: "stage.started" })
    store.appendJobEvent({ jobId: second.jobId, eventType: "stage.started" })
    store.appendJobEvent({ jobId: first.jobId, eventType: "stage.finished" })

    // sequence はジョブごとに独立。他ジョブの追記で飛んだりしない。
    const firstEvents = store.listJobEventsAfter({
      ownerId: "owner-1",
      jobId: first.jobId,
      afterSequence: 0,
    })
    expect(firstEvents.map((event) => event.sequence)).toEqual([1, 2])
    expect(firstEvents.map((event) => event.eventType)).toEqual([
      "stage.started",
      "stage.finished",
    ])

    const secondEvents = store.listJobEventsAfter({
      ownerId: "owner-1",
      jobId: second.jobId,
      afterSequence: 0,
    })
    expect(secondEvents.map((event) => event.sequence)).toEqual([1])
    store.close()
  })

  it("returns only events after the cursor", async () => {
    const store = createStore()
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "cursor",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [FEED_ID],
    })
    for (const eventType of ["one", "two", "three"]) {
      store.appendJobEvent({ jobId: created.jobId, eventType })
    }

    expect(
      store
        .listJobEventsAfter({
          ownerId: "owner-1",
          jobId: created.jobId,
          afterSequence: 2,
        })
        .map((event) => event.eventType)
    ).toEqual(["three"])
    store.close()
  })

  it("hides events from another owner", async () => {
    const store = createStore()
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "scoped",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [FEED_ID],
    })
    store.appendJobEvent({ jobId: created.jobId, eventType: "stage.started" })

    expect(
      store.listJobEventsAfter({
        ownerId: "owner-2",
        jobId: created.jobId,
        afterSequence: 0,
      })
    ).toEqual([])
    store.close()
  })

  it("records a terminal event when a job completes", async () => {
    const store = createStore()
    const created = await store.create({
      ownerId: "owner-1",
      idempotencyKey: "terminal",
      requestHash: "hash",
      trigger: "manual",
      feedIds: [FEED_ID],
    })
    const leased = store.leaseNext()!
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

    const events = store.listJobEventsAfter({
      ownerId: "owner-1",
      jobId: created.jobId,
      afterSequence: 0,
    })
    expect(events.at(-1)?.eventType).toBe("job.succeeded")
    store.close()
  })
})
