#!/usr/bin/env bash
set -euo pipefail

project_name="news-podcast-functional-e2e"
compose_file="infra/e2e/compose.yaml"

cleanup() {
  docker compose --project-name "$project_name" --file "$compose_file" down --volumes --remove-orphans
}
trap cleanup EXIT

docker compose --project-name "$project_name" --file "$compose_file" up --detach --wait
pnpm exec tsx scripts/functional-stack-e2e.ts
