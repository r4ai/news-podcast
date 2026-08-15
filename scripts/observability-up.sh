#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBSERVABILITY_DIR="$REPOSITORY_ROOT/infra/observability"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker with Compose is required." >&2
  exit 1
fi

docker compose --project-directory "$OBSERVABILITY_DIR" \
  -f "$OBSERVABILITY_DIR/compose.yaml" up -d --wait

node "$REPOSITORY_ROOT/scripts/ensure-grafana-mcp-token.mjs"
