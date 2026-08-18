#!/usr/bin/env bash
set -euo pipefail

packages=(
  @news-podcast/kernel
  @news-podcast/protocols
  @news-podcast/service-runtime
  @news-podcast/gateway
  @news-podcast/identity-access
  @news-podcast/content-knowledge
  @news-podcast/episode-production
  @news-podcast/episode-library
)

filters=()
for package_name in "${packages[@]}"; do
  filters+=(--filter "$package_name")
done

# Each Vitest process also uses workers. Keep both levels bounded so a hosted
# runner is fully used without turning CPU contention into timing flakes.
pnpm --workspace-concurrency="${COVERAGE_WORKSPACE_CONCURRENCY:-2}" \
  "${filters[@]}" \
  exec vitest run \
  --maxWorkers="${COVERAGE_MAX_WORKERS:-2}" \
  --coverage \
  --coverage.reporter=text-summary \
  --coverage.include='src/**/*.ts' \
  --coverage.exclude='src/**/*.test.ts' \
  --coverage.thresholds.lines=75 \
  --coverage.thresholds.statements=75 \
  --coverage.thresholds.branches=60 \
  --coverage.thresholds.functions=70
