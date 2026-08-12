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

for package_name in "${packages[@]}"; do
  pnpm --filter "$package_name" exec vitest run \
    --coverage \
    --coverage.reporter=text-summary \
    --coverage.include='src/**/*.ts' \
    --coverage.exclude='src/**/*.test.ts' \
    --coverage.thresholds.lines=75 \
    --coverage.thresholds.statements=75 \
    --coverage.thresholds.branches=60 \
    --coverage.thresholds.functions=70
done
