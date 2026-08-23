import { describe, expect, it, vi } from "vitest"

import {
  recordCancellationPropagation,
  recordEpisodeJobSnapshots,
  recordEpisodeWorkerEvent,
  recordScriptQualityObservation,
} from "./worker-observability.js"

describe("episode worker observability", () => {
  it("reports global and per-owner active-job saturation and queue age", () => {
    const gauge = vi.fn()

    recordEpisodeJobSnapshots(
      { gauge },
      {
        now: "2026-08-23T12:00:00.000Z",
        statuses: [
          {
            status: "Queued",
            count: 2,
            oldestActiveAt: "2026-08-23T11:58:00.000Z",
          },
        ],
        owners: [
          {
            ownerId: "owner-1",
            count: 1,
            oldestActiveAt: "2026-08-23T11:59:30.000Z",
          },
          {
            ownerId: "owner-2",
            count: 2,
            oldestActiveAt: "2026-08-23T11:58:30.000Z",
          },
        ],
      }
    )

    expect(gauge.mock.calls).toEqual([
      ["episode.jobs", 2, { "job.status": "Queued" }],
      ["episode.queue.oldest.age", 120_000],
      ["episode.owner.active_jobs", 2],
      ["episode.owner.queue.oldest.age", 90_000],
    ])
  })

  it("records versioned script quality without source or draft content", () => {
    const log = vi.fn()
    const count = vi.fn()

    recordScriptQualityObservation(
      { log, count },
      {
        model: "gpt-test",
        generationPromptVersion: "episode-script-v2",
        qualityPromptVersion: "episode-script-quality-v1",
        outcome: "reject",
        reasonCode: "prompt_injection",
      }
    )

    const attributes = {
      "gen_ai.request.model": "gpt-test",
      "episode.script.prompt.version": "episode-script-v2",
      "episode.script.quality_prompt.version": "episode-script-quality-v1",
      "quality.outcome": "reject",
      "quality.reason": "prompt_injection",
    }
    expect(count).toHaveBeenCalledWith("episode.script.quality", 1, attributes)
    expect(log).toHaveBeenCalledWith({
      name: "episode.script.quality_evaluated",
      level: "warn",
      attributes,
    })
    expect(attributes).not.toHaveProperty("source")
    expect(attributes).not.toHaveProperty("draft")
  })

  it("measures cancel-to-provider-abort latency with a bounded source tag", () => {
    const measure = vi.fn()

    recordCancellationPropagation(
      { measure },
      {
        jobId: "job-1" as never,
        source: "poll",
        latencyMillis: 250,
      }
    )

    expect(measure).toHaveBeenCalledWith(
      "episode.cancellation.propagation.duration",
      250,
      { source: "poll" }
    )
  })

  it.each([
    [
      "Retrying",
      "warn",
      "episode.retrying",
      {
        failureCode: "script_rate_limited",
        retryAt: "2026-08-15T09:20:00.000Z",
      },
    ],
    ["Failed", "error", "episode.failed", { failureCode: "script_refusal" }],
  ] as const)(
    "emits a structured %s business-failure log",
    (outcome, level, name, details) => {
      const log = vi.fn()
      const count = vi.fn()

      recordEpisodeWorkerEvent(
        { log, count },
        {
          _tag: "JobFinished",
          jobId: "job-1",
          attempt: 4,
          outcome: { _tag: outcome, ...details } as never,
        }
      )

      expect(log).toHaveBeenCalledWith({
        name,
        level,
        attributes: {
          "failure.code": details.failureCode,
          "failure.reason": outcome === "Retrying" ? "rate_limited" : "refusal",
          "failure.stage": "script",
          "job.attempt": 4,
          "job.id": "job-1",
          ...(outcome === "Retrying"
            ? { "job.next_retry_at": details.retryAt }
            : {}),
          "error.retryable": outcome === "Retrying",
        },
      })
    }
  )

  it("records lease recovery and successful completion", () => {
    const log = vi.fn()
    const count = vi.fn()
    const measure = vi.fn()
    const telemetry = { log, count, measure }

    recordEpisodeWorkerEvent(telemetry, {
      _tag: "JobLeased",
      jobId: "job-1",
      attempt: 2,
      recovered: true,
      queueWaitMillis: 120_000,
    })
    recordEpisodeWorkerEvent(telemetry, {
      _tag: "JobFinished",
      jobId: "job-1",
      attempt: 2,
      outcome: { _tag: "Succeeded" },
    })

    expect(count.mock.calls).toEqual([
      ["episode.started", 1, { "job.attempt": 2 }],
      ["episode.lease.recovered"],
      ["episode.succeeded"],
    ])
    expect(measure).toHaveBeenCalledWith("episode.queue.wait.duration", 120_000)
    expect(log).not.toHaveBeenCalled()
  })

  it("counts jobs that reach the end-to-end deadline", () => {
    const count = vi.fn()
    recordEpisodeWorkerEvent(
      { log: vi.fn(), count },
      {
        _tag: "JobFinished",
        jobId: "job-1",
        attempt: 1,
        outcome: {
          _tag: "Failed",
          failureCode: "job_deadline_exceeded",
        } as never,
      }
    )

    expect(count).toHaveBeenCalledWith("episode.deadline.exceeded")
  })

  it.each([
    ["Canceled", "episode.canceled"],
    ["StaleLease", "episode.lease.lost"],
  ] as const)("records a %s completion", (outcome, metric) => {
    const count = vi.fn()
    recordEpisodeWorkerEvent(
      { log: vi.fn(), count },
      {
        _tag: "JobFinished",
        jobId: "job-1",
        attempt: 1,
        outcome: { _tag: outcome },
      }
    )
    expect(count).toHaveBeenCalledWith(metric)
  })

  it("emits infrastructure failures with their operation stage", () => {
    const log = vi.fn()
    const count = vi.fn()

    recordEpisodeWorkerEvent(
      { log, count },
      {
        _tag: "WorkerFailed",
        stage: "execute",
        jobId: "job-1",
        code: "sqlite_transition",
        retryable: true,
      }
    )

    expect(count).toHaveBeenCalledWith("process.error", 1, {
      "failure.code": "sqlite_transition",
      "failure.reason": "sqlite_transition",
      "failure.stage": "execute",
      "operation.stage": "execute",
    })
    expect(log).toHaveBeenCalledWith({
      name: "worker.tick.failed",
      level: "error",
      attributes: {
        "failure.code": "sqlite_transition",
        "job.id": "job-1",
        "operation.stage": "execute",
        "error.retryable": true,
      },
    })
  })
})
