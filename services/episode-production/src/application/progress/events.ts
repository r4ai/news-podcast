import type {
  DurableAgUiEvent,
  EpisodeJobStep,
  ProgressState,
} from "./model.js"
import { runIdFor } from "./model.js"

const durable = (
  state: ProgressState,
  occurredAt: string,
  eventKey: string,
  event: Readonly<Record<string, unknown>>
): DurableAgUiEvent => ({
  runId: runIdFor(state.jobId, state.attempt),
  eventType: String(event.type),
  occurredAt,
  payload: JSON.stringify({ timestamp: Date.parse(occurredAt), ...event }),
  eventKey,
})

export const stateSnapshotEvent = (
  state: ProgressState,
  occurredAt: string,
  eventKey: string
) =>
  durable(state, occurredAt, eventKey, {
    type: "STATE_SNAPSHOT",
    snapshot: state,
  })

export const runStartedEvent = (state: ProgressState, occurredAt: string) =>
  durable(
    state,
    occurredAt,
    `${state.jobId}:run:${state.attempt}:started:${occurredAt}`,
    {
      type: "RUN_STARTED",
      threadId: state.jobId,
      runId: runIdFor(state.jobId, state.attempt),
    }
  )

export const runErrorEvent = (
  state: ProgressState,
  occurredAt: string,
  failure: Readonly<{ code: string; retryable: boolean }>
) =>
  durable(
    state,
    occurredAt,
    `${state.jobId}:run:${state.attempt}:error:${state.status}`,
    {
      type: "RUN_ERROR",
      message: failure.retryable
        ? "Episode generation will be retried"
        : "Episode generation failed",
      code: failure.code,
    }
  )

export const runFinishedEvent = (state: ProgressState, occurredAt: string) =>
  durable(state, occurredAt, `${state.jobId}:run:${state.attempt}:finished`, {
    type: "RUN_FINISHED",
    threadId: state.jobId,
    runId: runIdFor(state.jobId, state.attempt),
    outcome: { type: "success" },
  })

export const stepStartedEvent = (
  state: ProgressState,
  step: EpisodeJobStep,
  occurredAt: string
) =>
  durable(
    state,
    occurredAt,
    `${state.jobId}:run:${state.attempt}:step:${step}:started`,
    {
      type: "STEP_STARTED",
      stepName: step,
    }
  )

export const stepFinishedEvent = (
  state: ProgressState,
  step: EpisodeJobStep,
  occurredAt: string
) =>
  durable(
    state,
    occurredAt,
    `${state.jobId}:run:${state.attempt}:step:${step}:finished`,
    {
      type: "STEP_FINISHED",
      stepName: step,
    }
  )
