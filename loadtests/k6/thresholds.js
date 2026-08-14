export const normalThresholds = {
  http_req_failed: ["rate<0.01"],
  loadtest_api_latency: ["p(95)<2000", "p(99)<5000"],
  loadtest_api_error: ["rate<0.01"],
  loadtest_job_enqueue_latency: ["p(95)<2000"],
  loadtest_job_enqueue_success: ["rate>0.99"],
  loadtest_job_success: ["rate>0.99"],
  loadtest_job_terminal: ["rate>0.99"],
  loadtest_job_completion: ["p(95)<60000"],
}

export const chaosThresholds = {
  http_req_failed: ["rate<0.01"],
  loadtest_api_latency: ["p(95)<5000"],
  loadtest_api_error: ["rate<0.01"],
  loadtest_job_enqueue_latency: ["p(95)<5000"],
  loadtest_job_enqueue_success: ["rate>0.99"],
  loadtest_job_terminal: ["rate>0.99"],
  loadtest_chaos_expected_terminal: ["rate>0.99"],
}

export const invalidProviderThresholds = {
  loadtest_chaos_publication_checks: ["count>0"],
  loadtest_chaos_publication_leak: ["rate<0.001"],
}
