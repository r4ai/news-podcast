#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBSERVABILITY_DIR="$REPOSITORY_ROOT/infra/observability"
FOUNDRYCTL_BIN="${FOUNDRYCTL_BIN:-foundryctl}"

if ! command -v "$FOUNDRYCTL_BIN" >/dev/null 2>&1; then
  echo "foundryctl is required. Install it with:" >&2
  echo "  curl -fsSL https://signoz.io/foundry.sh | bash" >&2
  exit 1
fi

cd "$OBSERVABILITY_DIR"
"$FOUNDRYCTL_BIN" gauge -f casting.yaml
"$FOUNDRYCTL_BIN" forge -f casting.yaml

# Foundry writes generated files with owner-only permissions. ClickHouse runs
# as a non-root user and needs to read the bind-mounted configuration files.
chmod -R a+rX pours/deployment

docker compose \
  -f pours/deployment/compose.yaml \
  -f compose.local.yaml \
  up -d
