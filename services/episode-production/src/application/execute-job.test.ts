import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  IdempotencyKeySchema,
  JobIdSchema,
  LeaseTokenSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  leaseQueuedJob,
  newQueuedJob,
} from "../domain/episode-job.js"
import { ReadingDictionarySnapshotSchema } from "../domain/reading-dictionary.js"
import type { GenerationPlan } from "../domain/generation-plan.js"
import { executeEpisodeJob } from "./execute-job.js"
import type {
  EpisodeExecutionCheckpoint,
  EpisodeExecutionPorts,
} from "./ports/execution.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const at = (value: string) => decode(UtcTimestampSchema, value)
const running = leaseQueuedJob(
  newQueuedJob({
    jobId: decode(JobIdSchema, "10e2d4e1-c127-479f-a124-2ea037bd9319"),
    ownerId: decode(OwnerIdSchema, "owner-1"),
    idempotencyKey: decode(IdempotencyKeySchema, "request-1"),
    trigger: "manual",
    articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40" as never],
    enqueuedAt: at("2026-08-12T00:00:00.000Z"),
  }),
  {
    token: decode(LeaseTokenSchema, "lease-1"),
    startedAt: at("2026-08-12T00:00:01.000Z"),
    leasedUntil: at("2026-08-12T00:01:01.000Z"),
  }
)

const article = {
  articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  title: "News 1",
  url: "https://example.com/news/1",
  markdown: "Body",
} as const

const makePorts = (overrides: Partial<EpisodeExecutionPorts> = {}) => {
  let checkpoint: EpisodeExecutionCheckpoint | undefined
  let generationPlan: GenerationPlan | undefined
  let dictionarySnapshot:
    | Schema.Schema.Type<typeof ReadingDictionarySnapshotSchema>
    | undefined
  const ports: EpisodeExecutionPorts = {
    planning: {
      create: vi.fn((input) =>
        Effect.succeed({
          jobId: input.jobId,
          ownerId: input.ownerId,
          selectionMode:
            input.selection._tag === "Automatic"
              ? ("automatic" as const)
              : ("manual" as const),
          interestProfile: { include: "AI", exclude: "広告" },
          selectedArticleIds:
            input.selection._tag === "Manual"
              ? (input.selection.articleIds as never)
              : ([article.articleId] as never),
          model: "gpt-test",
          createdAt: at("2026-08-12T00:00:02.000Z"),
        })
      ),
    },
    articles: {
      materialize: vi.fn(() => Effect.succeed([article] as const)),
    },
    script: {
      generate: vi.fn(() =>
        Effect.succeed({
          title: "Daily news",
          script: "Script",
          sourceUrls: [article.url],
        })
      ),
    },
    speech: {
      synthesize: vi.fn(() => Effect.succeed(new Uint8Array([1, 2, 3]))),
    },
    audio: {
      put: vi.fn(({ episodeId }) =>
        Effect.succeed({
          episodeId,
          objectKey: `episodes/${episodeId}.wav`,
          byteLength: 3,
          contentType: "audio/wav" as const,
        })
      ),
      remove: vi.fn(() => Effect.void),
    },
    dictionary: {
      prepare: vi.fn(() =>
        Effect.succeed(
          Schema.decodeUnknownSync(ReadingDictionarySnapshotSchema)({
            ownerId: running.request.ownerId,
            fingerprint: "a".repeat(64),
            entries: [],
          })
        )
      ),
    },
    persistence: {
      markStep: vi.fn(() => Effect.void),
      reportStageProgress: vi.fn(() => Effect.void),
      recordSelectedArticles: vi.fn(() => Effect.void),
      renewLease: () => Effect.succeed("Applied"),
      assertLease: vi.fn(() => Effect.void),
      loadCheckpoint: vi.fn(() => Effect.succeed(checkpoint as never)),
      loadGenerationPlan: vi.fn(() => Effect.succeed(generationPlan)),
      listUsedAutomaticArticleIds: vi.fn(() => Effect.succeed([])),
      saveGenerationPlan: vi.fn((input) =>
        Effect.sync(() => {
          generationPlan ??= input.plan
          return generationPlan as GenerationPlan
        })
      ),
      loadDictionarySnapshot: vi.fn(() => Effect.succeed(dictionarySnapshot)),
      saveDictionarySnapshot: vi.fn((input) =>
        Effect.sync(() => {
          dictionarySnapshot ??= input.snapshot
        })
      ),
      saveScriptCheckpoint: vi.fn((input) =>
        Effect.sync(() => {
          checkpoint = { ...checkpoint, script: input.script }
        })
      ),
      saveAudioCheckpoint: vi.fn((input) =>
        Effect.sync(() => {
          if (checkpoint === undefined) {
            throw new Error("script checkpoint must precede audio")
          }
          checkpoint = { ...checkpoint, audio: input.audio }
        })
      ),
      transition: vi.fn(() => Effect.succeed("Applied" as const)),
      completeWithOutbox: vi.fn(() => Effect.succeed("Applied" as const)),
    },
    nextEpisodeId: () => "6518412b-ce2f-4641-9f2c-a02dd515bc31" as never,
    now: () => at("2026-08-12T00:00:30.000Z"),
    nextRetryAt: () => at("2026-08-12T00:01:30.000Z"),
    ...overrides,
  }
  return ports
}

describe("executeEpisodeJob", () => {
  it("captures and fences one immutable dictionary snapshot per job", async () => {
    const first = makePorts()

    await Effect.runPromise(executeEpisodeJob(first)({ job: running }))

    expect(first.dictionary.prepare).toHaveBeenCalledTimes(1)
    expect(first.dictionary.prepare).toHaveBeenCalledWith({
      ownerId: "owner-1",
      jobId: running.jobId,
      script: "Script",
    })
    expect(first.persistence.saveDictionarySnapshot).toHaveBeenCalledWith({
      jobId: running.jobId,
      leaseToken: running.lease.token,
      snapshot: expect.objectContaining({ fingerprint: "a".repeat(64) }),
    })
    expect(first.speech.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        dictionarySnapshot: expect.objectContaining({
          fingerprint: "a".repeat(64),
        }),
      }),
      expect.any(Function)
    )

    const saved = vi.mocked(first.persistence.saveDictionarySnapshot).mock
      .calls[0]![0].snapshot
    const resumed = makePorts({
      dictionary: {
        prepare: vi.fn(() => Effect.die("must use persisted snapshot")),
      },
      persistence: {
        ...first.persistence,
        loadDictionarySnapshot: () => Effect.succeed(saved),
      },
    })
    await Effect.runPromise(executeEpisodeJob(resumed)({ job: running }))
    expect(resumed.dictionary.prepare).not.toHaveBeenCalled()
  })

  it("plans automatic selection once, then materializes the frozen article IDs", async () => {
    const automaticJob = {
      ...running,
      request: { ...running.request, articleIds: undefined },
    } as typeof running
    const ports = makePorts()
    const previouslyUsed = "3c4d046c-b47b-4047-a562-66ac7e74e996" as never
    vi.mocked(ports.persistence.listUsedAutomaticArticleIds).mockReturnValue(
      Effect.succeed([previouslyUsed])
    )

    await Effect.runPromise(executeEpisodeJob(ports)({ job: automaticJob }))

    expect(ports.articles.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        selection: {
          _tag: "Selected",
          articleIds: [article.articleId],
        },
      })
    )
    expect(ports.planning.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          _tag: "Automatic",
          excludedArticleIds: [previouslyUsed],
        },
      })
    )
  })

  it("completes selected sources and atomically writes success plus outbox intent", async () => {
    const ports = makePorts()
    vi.mocked(ports.speech.synthesize).mockImplementation(
      (_request, onProgress) =>
        onProgress!({ completed: 1, total: 1 }).pipe(
          Effect.as(new Uint8Array([1, 2, 3]))
        )
    )
    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )

    expect(outcome._tag).toBe("Succeeded")
    expect(ports.articles.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        selection: { _tag: "Selected", articleIds: running.request.articleIds },
      })
    )
    expect(ports.script.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        interestProfile: { include: "AI", exclude: "広告" },
      })
    )
    expect(ports.audio.put).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        jobId: running.jobId,
        episodeId: "6518412b-ce2f-4641-9f2c-a02dd515bc31",
      })
    )
    expect(ports.persistence.reportStageProgress).toHaveBeenCalledWith({
      jobId: running.jobId,
      leaseToken: running.lease.token,
      step: "synthesizing_audio",
      completed: 1,
      total: 1,
      occurredAt: at("2026-08-12T00:00:30.000Z"),
    })
    expect(ports.persistence.completeWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseToken: "lease-1",
        state: expect.objectContaining({ _tag: "Succeeded" }),
        completion: expect.objectContaining({
          ownerId: "owner-1",
          script: "Script",
          audio: expect.objectContaining({ byteLength: 3 }),
        }),
      })
    )
  })

  it("resumes after a script checkpoint without charging the generator twice", async () => {
    const first = makePorts()
    vi.mocked(first.speech.synthesize).mockReturnValueOnce(
      Effect.fail({ _tag: "TransportFailure" })
    )
    const firstOutcome = await Effect.runPromise(
      executeEpisodeJob(first)({ job: running })
    )
    expect(firstOutcome._tag).toBe("Retrying")

    const savedScript = vi.mocked(first.persistence.saveScriptCheckpoint).mock
      .calls[0]![0].script
    const resumed = makePorts({
      persistence: {
        ...first.persistence,
        loadCheckpoint: () => Effect.succeed({ script: savedScript }),
      },
    })
    const outcome = await Effect.runPromise(
      executeEpisodeJob(resumed)({ job: running })
    )
    expect(outcome._tag).toBe("Succeeded")
    expect(resumed.script.generate).not.toHaveBeenCalled()
  })

  it("propagates cancellation and never starts provider work", async () => {
    const ports = makePorts()
    const controller = new AbortController()
    controller.abort()
    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running, signal: controller.signal })
    )
    expect(outcome._tag).toBe("Canceled")
    expect(ports.script.generate).not.toHaveBeenCalled()
  })

  it("fails an expired job terminally instead of treating it as user cancellation", async () => {
    const ports = makePorts()
    const controller = new AbortController()
    controller.abort("job_deadline_exceeded")

    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running, signal: controller.signal })
    )

    expect(outcome).toEqual({
      _tag: "Failed",
      failureCode: "job_deadline_exceeded",
    })
    expect(
      vi.mocked(ports.persistence.transition).mock.calls[0]![0]
    ).toMatchObject({
      state: {
        _tag: "Failed",
        failure: { code: "job_deadline_exceeded", retryable: false },
      },
    })
  })

  it("classifies a provider abort at the job deadline as a terminal deadline failure", async () => {
    const controller = new AbortController()
    const ports = makePorts({
      speech: {
        synthesize: () =>
          Effect.sync(() => controller.abort("job_deadline_exceeded")).pipe(
            Effect.andThen(Effect.fail({ _tag: "Canceled" as const }))
          ),
      },
    })

    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running, signal: controller.signal })
    )

    expect(outcome).toEqual({
      _tag: "Failed",
      failureCode: "job_deadline_exceeded",
    })
    expect(
      vi.mocked(ports.persistence.transition).mock.calls[0]![0]
    ).toMatchObject({
      state: {
        _tag: "Failed",
        failure: { code: "job_deadline_exceeded", retryable: false },
      },
    })
  })

  it("rejects a stale lease before materializing sources", async () => {
    const ports = makePorts()
    vi.mocked(ports.persistence.assertLease).mockReturnValue(
      Effect.fail({ _tag: "StaleLease" })
    )
    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )
    expect(outcome).toEqual({ _tag: "StaleLease" })
    expect(ports.articles.materialize).not.toHaveBeenCalled()
  })

  it("removes a newly uploaded object when its checkpoint loses the lease", async () => {
    const persisted = vi.fn()
    const base = makePorts()
    const ports = makePorts({
      persistence: {
        ...base.persistence,
        saveAudioCheckpoint: () => Effect.sync(persisted),
      },
    })
    vi.mocked(ports.persistence.assertLease).mockImplementation(() =>
      vi.mocked(ports.audio.put).mock.calls.length === 0
        ? Effect.void
        : Effect.fail({ _tag: "StaleLease" })
    )

    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )

    expect(outcome).toEqual({ _tag: "StaleLease" })
    expect(ports.audio.remove).toHaveBeenCalledWith(
      "episodes/6518412b-ce2f-4641-9f2c-a02dd515bc31.wav"
    )
    expect(persisted).not.toHaveBeenCalled()
  })

  it("rejects invalid script sources before synthesizing or uploading audio", async () => {
    const ports = makePorts({
      script: {
        generate: () =>
          Effect.succeed({
            title: "Invalid",
            script: "Script",
            sourceUrls: ["https://example.com/not-materialized"],
          }),
      },
    })

    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )

    expect(outcome).toEqual({
      _tag: "Failed",
      failureCode: "invalid_script_sources",
    })
    expect(ports.speech.synthesize).not.toHaveBeenCalled()
    expect(ports.audio.put).not.toHaveBeenCalled()
  })

  it("treats a duplicate atomic completion as idempotent success", async () => {
    const ports = makePorts()
    vi.mocked(ports.persistence.completeWithOutbox).mockReturnValue(
      Effect.succeed("Duplicate")
    )
    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )
    expect(outcome).toEqual({ _tag: "Duplicate" })
  })

  it.each([
    [
      "retryable script",
      { _tag: "TransportFailure" },
      "Retrying",
      "script_unavailable",
    ],
    ["permanent script", { _tag: "Refusal" }, "Failed", "script_refusal"],
  ] as const)(
    "maps %s provider failure",
    async (_case, failure, expected, code) => {
      const ports = makePorts()
      vi.mocked(ports.script.generate).mockReturnValue(Effect.fail(failure))
      const outcome = await Effect.runPromise(
        executeEpisodeJob(ports)({ job: running })
      )
      expect(outcome._tag).toBe(expected)
      expect(outcome).toMatchObject({ failureCode: code })
      expect(
        vi.mocked(ports.persistence.transition).mock.calls[0]![0]
      ).toMatchObject({
        state: { failure: { code } },
      })
    }
  )

  it("distinguishes a malformed speech response from script generation", async () => {
    const ports = makePorts()
    vi.mocked(ports.speech.synthesize).mockReturnValue(
      Effect.fail({ _tag: "MalformedResponse" })
    )

    await Effect.runPromise(executeEpisodeJob(ports)({ job: running }))

    expect(
      vi.mocked(ports.persistence.transition).mock.calls[0]![0]
    ).toMatchObject({
      state: { failure: { code: "speech_malformed_response" } },
    })
  })

  it("preserves provider cancellation as a canceled job", async () => {
    const ports = makePorts()
    vi.mocked(ports.script.generate).mockReturnValue(
      Effect.fail({ _tag: "Canceled" })
    )

    const outcome = await Effect.runPromise(
      executeEpisodeJob(ports)({ job: running })
    )

    expect(outcome).toEqual({ _tag: "Canceled" })
    expect(
      vi.mocked(ports.persistence.transition).mock.calls[0]![0]
    ).toMatchObject({
      state: { _tag: "Canceled", reason: "requested_by_user" },
    })
  })
})
