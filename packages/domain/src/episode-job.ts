export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

const allowedTargets: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  queued: new Set(["running", "canceled"]),
  running: new Set(["succeeded", "failed", "canceled"]),
  succeeded: new Set(),
  failed: new Set(),
  canceled: new Set(),
}

export class InvalidJobTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Episode job cannot transition from ${from} to ${to}`)
    this.name = "InvalidJobTransitionError"
  }
}

export function transitionJob(from: JobStatus, to: JobStatus): JobStatus {
  if (!allowedTargets[from].has(to)) {
    throw new InvalidJobTransitionError(from, to)
  }

  return to
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return allowedTargets[status].size === 0
}
