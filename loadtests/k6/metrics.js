import { Counter, Rate, Trend } from "k6/metrics"

export const apiLatency = new Trend("loadtest_api_latency", true)
export const apiError = new Rate("loadtest_api_error")
export const enqueueLatency = new Trend("loadtest_job_enqueue_latency", true)
export const enqueueSuccess = new Rate("loadtest_job_enqueue_success")
export const jobSuccess = new Rate("loadtest_job_success")
export const jobTerminal = new Rate("loadtest_job_terminal")
export const jobCompletion = new Trend("loadtest_job_completion", true)
export const ownerMismatch = new Rate("loadtest_owner_mismatch")
export const ownerIsolationChecks = new Counter(
  "loadtest_owner_isolation_checks"
)
export const chaosExpectedTerminal = new Rate(
  "loadtest_chaos_expected_terminal"
)
export const chaosPublicationLeak = new Rate("loadtest_chaos_publication_leak")
export const chaosPublicationChecks = new Counter(
  "loadtest_chaos_publication_checks"
)
export const completedJobs = new Counter("loadtest_completed_jobs")
