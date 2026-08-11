import { describe, expect, it, vi } from "vitest"

import { CreateEpisodeJob } from "./create-episode-job.js"

describe("CreateEpisodeJob", () => {
  it("snapshots enabled subscriptions and dispatches one new job", async () => {
    const create = vi.fn().mockResolvedValue({
      jobId: "job-1",
      ownerId: "owner-1",
      createdAt: new Date(0),
      created: true,
    })
    const dispatch = vi.fn().mockResolvedValue(undefined)
    const useCase = new CreateEpisodeJob(
      { listEnabledFeedIds: vi.fn().mockResolvedValue(["feed-a", "feed-b"]) },
      { create },
      { dispatch }
    )

    await useCase.execute({
      ownerId: "owner-1",
      idempotencyKey: "request-1",
      trigger: "manual",
    })

    expect(create).toHaveBeenCalledWith({
      ownerId: "owner-1",
      idempotencyKey: "request-1",
      requestHash: JSON.stringify({
        trigger: "manual",
        feedIds: ["feed-a", "feed-b"],
        articleIds: [],
      }),
      trigger: "manual",
      feedIds: ["feed-a", "feed-b"],
    })
    expect(dispatch).toHaveBeenCalledWith({
      ownerId: "owner-1",
      jobId: "job-1",
    })
  })

  it("does not dispatch an idempotent replay", async () => {
    const dispatch = vi.fn()
    const useCase = new CreateEpisodeJob(
      { listEnabledFeedIds: vi.fn().mockResolvedValue(["feed-a"]) },
      {
        create: vi.fn().mockResolvedValue({
          jobId: "job-1",
          ownerId: "owner-1",
          createdAt: new Date(0),
          created: false,
        }),
      },
      { dispatch }
    )

    await useCase.execute({
      ownerId: "owner-1",
      idempotencyKey: "request-1",
      trigger: "manual",
    })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
