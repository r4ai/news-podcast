#!/usr/bin/env bash
set -euo pipefail

project_name="news-podcast-functional-e2e"
compose_file="infra/e2e/compose.yaml"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_directory="${RUNNER_TEMP:-$repository_root/artifacts}/functional-e2e"
mkdir -p "$log_directory"

cleanup() {
  status=$?
  if (( status != 0 )); then
    docker compose \
      --project-name "$project_name" \
      --file "$compose_file" \
      logs --no-color >"$log_directory/compose.log" 2>&1 || true
  fi
  docker compose --project-name "$project_name" --file "$compose_file" down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT

docker compose --project-name "$project_name" --file "$compose_file" up --detach --wait
timeout --signal=TERM --kill-after=30s 300s pnpm exec tsx scripts/functional-stack-e2e.ts
